// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/types/PoolOperation.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";

import {OrbitalV4Hook} from "../src/OrbitalV4Hook.sol";
import {Torus4} from "../src/math/Torus4.sol";
import {OrbitalDemoConfig} from "../script/OrbitalDeployBase.sol";
import {OrbitalTestBase} from "./utils/OrbitalTestBase.sol";

/// @notice End-to-end tests through a real v4 PoolManager and the v4-core test routers.
contract OrbitalV4HookTest is OrbitalTestBase {
    uint24 private constant FEE = OrbitalDemoConfig.FEE;
    address private alice = makeAddr("alice");

    function setUp() public {
        _deployManager();
        _deployTokens([uint8(6), 6, 18, 18]);
        hook = _deployHook(address(this));
        _initializePools(hook);
        _fund(address(this));
        hook.seed(address(this));
    }

    // ------------------------------------------------------------------
    // Seeding and custody
    // ------------------------------------------------------------------

    function testSwapsRevertBeforeSeed() public {
        OrbitalV4Hook unseeded = _deployHook(address(0xB0B));
        _initializePools(unseeded);
        _expectHookRevert(
            address(unseeded), IHooks.beforeSwap.selector, abi.encodeWithSelector(OrbitalV4Hook.NotSeeded.selector)
        );
        _swapOn(unseeded, 0, 1, 10 ** decimals[0], "");
    }

    function testOnlyOwnerSeedsOnce() public {
        vm.expectRevert(OrbitalV4Hook.AlreadySeeded.selector);
        hook.seed(address(this));

        OrbitalV4Hook other = _deployHook(address(0xB0B));
        vm.expectRevert(OrbitalV4Hook.OnlyOwner.selector);
        other.seed(address(this));
    }

    function testSeedHoldsRealInventoryAsManagerClaims() public view {
        (uint256[4] memory custody, uint256[4] memory required) = hook.solvency();
        uint256[4] memory reserves = hook.reserves();
        for (uint256 i; i < 4; ++i) {
            assertEq(custody[i], manager.balanceOf(address(hook), currencies[i].toId()));
            assertGe(custody[i], required[i]);
            assertGt(required[i], 0);
            // Concentration: real inventory is far below the virtual coordinate.
            assertLt(required[i] * _scale(i), reserves[i] / 2);
        }
        for (uint256 range; range < 3; ++range) {
            assertGt(hook.sharesOf(range, address(this)), 0);
        }
    }

    // ------------------------------------------------------------------
    // Swaps
    // ------------------------------------------------------------------

    function testSixDecimalInputPaysEighteenDecimalOutput() public {
        (uint8 usdc, uint8 dai) = (_indexOf("USDC"), _indexOf("DAI"));
        uint256 amountIn = 1_000 * 10 ** decimals[usdc];
        (uint256 paid, uint256 received) = _swapAndMeasure(usdc, dai, amountIn, "");

        assertEq(paid, amountIn);
        assertGt(received, 998 * 10 ** decimals[dai]);
        assertLt(received, 1_000 * 10 ** decimals[dai]);
        _assertSolvent();
    }

    function testEighteenDecimalInputPaysSixDecimalOutput() public {
        (uint8 dai, uint8 usdt) = (_indexOf("DAI"), _indexOf("USDT"));
        uint256 amountIn = 1_000 * 10 ** decimals[dai];
        (uint256 paid, uint256 received) = _swapAndMeasure(dai, usdt, amountIn, "");

        assertEq(paid, amountIn);
        assertGt(received, 998 * 10 ** decimals[usdt]);
        assertLt(received, 1_000 * 10 ** decimals[usdt]);
        _assertSolvent();
    }

    function testAllSixPairsAdvanceOneSharedBook() public {
        for (uint8 a; a < 4; ++a) {
            for (uint8 b = a + 1; b < 4; ++b) {
                uint256[4] memory before = hook.reserves();
                _swapAndMeasure(a, b, 100 * 10 ** decimals[a], "");
                uint256[4] memory afterSwap = hook.reserves();
                for (uint8 i; i < 4; ++i) {
                    if (i == a) assertGt(afterSwap[i], before[i]);
                    else if (i == b) assertLt(afterSwap[i], before[i]);
                    else assertEq(afterSwap[i], before[i]);
                }
                assertTrue(Torus4.isInvariant(hook.state(), afterSwap));
                _assertSolvent();
            }
        }
    }

    function testCrossingAndRecoveryThroughManager() public {
        (uint8 input, uint8 output) = (_indexOf("USDC"), _indexOf("DAI"));
        _swapAndMeasure(input, output, 1_000_000 * 10 ** decimals[input], "");
        assertFalse(hook.tickIsInterior(0));
        _assertSolvent();

        _swapAndMeasure(output, input, 1_000_000 * 10 ** decimals[output], "");
        assertTrue(hook.tickIsInterior(0));
        _assertSolvent();
    }

    function testFeeAccruesToRangesAndLpCollects() public {
        (uint8 input, uint8 output) = (_indexOf("USDC"), _indexOf("USDT"));
        uint256 amountIn = 10_000 * 10 ** decimals[input];
        _swapAndMeasure(input, output, amountIn, "");
        uint256 fee = (amountIn * FEE + 999_999) / 1_000_000;

        uint256 before = MockERC20(Currency.unwrap(currencies[input])).balanceOf(address(this));
        uint256 collected;
        for (uint256 range; range < 3; ++range) {
            collected += hook.collectFees(range, address(this))[input];
        }
        uint256 afterCollect = MockERC20(Currency.unwrap(currencies[input])).balanceOf(address(this));

        assertEq(afterCollect - before, collected);
        assertLe(collected, fee);
        // Locked minimum shares and per-share rounding retain only a negligible remainder.
        assertGe(collected, fee - fee / 1_000);
        _assertSolvent();
    }

    function testSlippageAndDeadlineAreEnforced() public {
        (uint8 input, uint8 output) = (_indexOf("DAI"), _indexOf("FRAX"));
        uint256 amountIn = 10 * 10 ** decimals[input];

        _expectHookRevert(
            address(hook), IHooks.beforeSwap.selector, abi.encodeWithSelector(OrbitalV4Hook.SlippageExceeded.selector)
        );
        _swapOn(hook, input, output, amountIn, abi.encode(amountIn, block.timestamp));

        _expectHookRevert(
            address(hook), IHooks.beforeSwap.selector, abi.encodeWithSelector(OrbitalV4Hook.Expired.selector)
        );
        _swapOn(hook, input, output, amountIn, abi.encode(uint256(0), block.timestamp - 1));

        (, uint256 received) = _swapAndMeasure(input, output, amountIn, abi.encode(9 * WAD, block.timestamp));
        assertGe(received, 9 * WAD);
    }

    function testExactOutputIsRejected() public {
        PoolKey memory key = _key(hook, 0, 1);
        _expectHookRevert(
            address(hook),
            IHooks.beforeSwap.selector,
            abi.encodeWithSelector(OrbitalV4Hook.ExactOutputUnsupported.selector)
        );
        swapRouter.swap(
            key,
            SwapParams({zeroForOne: true, amountSpecified: 1e6, sqrtPriceLimitX96: MIN_PRICE_LIMIT}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }

    function testNativeLiquidityIsRejected() public {
        _expectHookRevert(
            address(hook),
            IHooks.beforeAddLiquidity.selector,
            abi.encodeWithSelector(OrbitalV4Hook.UnsupportedCallback.selector)
        );
        modifyLiquidityRouter.modifyLiquidity(
            _key(hook, 0, 1),
            ModifyLiquidityParams({tickLower: -120, tickUpper: 120, liquidityDelta: 1e18, salt: 0}),
            ""
        );
    }

    function testForeignPoolsCannotInitialize() public {
        PoolKey memory key = _key(hook, 0, 1);
        key.fee = FEE + 1;
        _expectHookRevert(
            address(hook),
            IHooks.beforeInitialize.selector,
            abi.encodeWithSelector(OrbitalV4Hook.UnsupportedPool.selector)
        );
        manager.initialize(key, SQRT_PRICE_1_1);
    }

    function testDirectHookCallsAreRejected() public {
        vm.expectRevert(OrbitalV4Hook.OnlyPoolManager.selector);
        hook.beforeSwap(
            address(this),
            _key(hook, 0, 1),
            SwapParams({zeroForOne: true, amountSpecified: -1e6, sqrtPriceLimitX96: MIN_PRICE_LIMIT}),
            ""
        );
    }

    // ------------------------------------------------------------------
    // Range liquidity
    // ------------------------------------------------------------------

    function testAddAndRemoveLiquidityRoundTrip() public {
        _fund(alice);
        uint256 range = 1;
        uint256 shares = hook.totalShares(range) / 100;
        uint256[4] memory quotedIn = hook.previewAddLiquidity(range, shares);

        vm.prank(alice);
        uint256[4] memory amountsIn = hook.addLiquidity(range, shares, quotedIn, block.timestamp);
        assertEq(hook.sharesOf(range, alice), shares);
        _assertSolvent();
        assertTrue(Torus4.isInvariant(hook.state(), hook.reserves()));

        uint256[4] memory quotedOut = hook.previewRemoveLiquidity(range, shares);
        vm.prank(alice);
        uint256[4] memory amountsOut = hook.removeLiquidity(range, shares, quotedOut, block.timestamp);
        assertEq(hook.sharesOf(range, alice), 0);
        for (uint256 i; i < 4; ++i) {
            assertEq(amountsIn[i], quotedIn[i]);
            assertEq(amountsOut[i], quotedOut[i]);
            assertGt(amountsIn[i], 0);
            assertLe(amountsOut[i], amountsIn[i]);
            // Round-trip loss is bounded by per-asset rounding, not a material haircut.
            assertLe(amountsIn[i] - amountsOut[i], 3);
        }
        _assertSolvent();
        assertTrue(Torus4.isInvariant(hook.state(), hook.reserves()));
    }

    function testLiquidityGuards() public {
        _fund(alice);
        uint256 shares = hook.totalShares(0) / 100;
        uint256[4] memory quotedIn = hook.previewAddLiquidity(0, shares);

        uint256[4] memory tooLittle = quotedIn;
        tooLittle[0] -= 1;
        vm.prank(alice);
        vm.expectRevert(OrbitalV4Hook.SlippageExceeded.selector);
        hook.addLiquidity(0, shares, tooLittle, block.timestamp);

        vm.prank(alice);
        vm.expectRevert(OrbitalV4Hook.Expired.selector);
        hook.addLiquidity(0, shares, quotedIn, block.timestamp - 1);

        uint256[4] memory none;
        vm.prank(alice);
        vm.expectRevert(OrbitalV4Hook.InsufficientShares.selector);
        hook.removeLiquidity(0, 1, none, block.timestamp);
    }

    function testLiquidityChangesReachTheSwapBook() public {
        _fund(alice);
        uint256 shares = hook.totalShares(2) / 10;
        uint256[4] memory before = hook.reserves();
        vm.prank(alice);
        hook.addLiquidity(2, shares, hook.previewAddLiquidity(2, shares), block.timestamp);
        uint256[4] memory afterAdd = hook.reserves();
        for (uint256 i; i < 4; ++i) {
            assertGt(afterAdd[i], before[i]);
        }
        _swapAndMeasure(0, 1, 1_000 * 10 ** decimals[0], "");
        _assertSolvent();
    }
}
