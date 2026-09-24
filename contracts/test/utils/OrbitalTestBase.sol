// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {SwapParams} from "v4-core/types/PoolOperation.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {CustomRevert} from "v4-core/libraries/CustomRevert.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";

import {OrbitalV4Hook} from "../../src/OrbitalV4Hook.sol";
import {SegmentedTorus4} from "../../src/math/SegmentedTorus4.sol";
import {HookAddressMiner} from "../../src/deploy/HookAddressMiner.sol";
import {OrbitalDemoConfig} from "../../script/OrbitalDeployBase.sol";

/// @notice Real PoolManager + v4-core test routers + a mock four-token basket.
abstract contract OrbitalTestBase is Test {
    uint256 internal constant WAD = 1e18;
    int24 internal constant TICK_SPACING = OrbitalDemoConfig.TICK_SPACING;
    uint160 internal constant FLAGS = OrbitalDemoConfig.FLAGS;
    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    uint160 internal constant MIN_PRICE_LIMIT = TickMath.MIN_SQRT_PRICE + 1;
    uint160 internal constant MAX_PRICE_LIMIT = TickMath.MAX_SQRT_PRICE - 1;

    IPoolManager internal manager;
    PoolSwapTest internal swapRouter;
    PoolModifyLiquidityTest internal modifyLiquidityRouter;
    OrbitalV4Hook internal hook;
    Currency[4] internal currencies;
    uint8[4] internal decimals;
    uint24 internal poolFee = OrbitalDemoConfig.FEE;

    function _deployManager() internal {
        manager = IPoolManager(deployCode("PoolManager.sol:PoolManager", abi.encode(address(this))));
        swapRouter = new PoolSwapTest(manager);
        modifyLiquidityRouter = new PoolModifyLiquidityTest(manager);
    }

    // ------------------------------------------------------------------

    function _deployTokens(uint8[4] memory tokenDecimals) internal {
        string[4] memory symbols = ["USDC", "USDT", "DAI", "FRAX"];
        MockERC20[4] memory tokens;
        for (uint256 i; i < 4; ++i) {
            tokens[i] = new MockERC20(symbols[i], symbols[i], tokenDecimals[i]);
        }
        // Insertion sort by address: v4 requires canonical currency order.
        for (uint256 i = 1; i < 4; ++i) {
            for (uint256 j = i; j > 0 && address(tokens[j - 1]) > address(tokens[j]); --j) {
                (tokens[j - 1], tokens[j]) = (tokens[j], tokens[j - 1]);
            }
        }
        for (uint256 i; i < 4; ++i) {
            currencies[i] = Currency.wrap(address(tokens[i]));
            decimals[i] = tokens[i].decimals();
        }
    }

    function _deployHook(address owner) internal returns (OrbitalV4Hook deployed) {
        uint256[4] memory reserves = OrbitalDemoConfig.reserves();
        SegmentedTorus4.Tick[] memory ticks = OrbitalDemoConfig.ticks();
        bytes memory args = abi.encode(manager, currencies, decimals, reserves, ticks, poolFee, TICK_SPACING, owner);
        bytes memory initCode = abi.encodePacked(type(OrbitalV4Hook).creationCode, args);
        bytes32 salt = HookAddressMiner.find(address(this), keccak256(initCode), FLAGS, 200_000);
        deployed =
            new OrbitalV4Hook{salt: salt}(manager, currencies, decimals, reserves, ticks, poolFee, TICK_SPACING, owner);
    }

    function _initializePools(OrbitalV4Hook target) internal {
        for (uint8 a; a < 4; ++a) {
            for (uint8 b = a + 1; b < 4; ++b) {
                manager.initialize(_key(target, a, b), SQRT_PRICE_1_1);
            }
        }
    }

    function _fund(address account) internal {
        for (uint256 i; i < 4; ++i) {
            MockERC20 token = MockERC20(Currency.unwrap(currencies[i]));
            token.mint(account, 100_000_000 * 10 ** decimals[i]);
            vm.startPrank(account);
            token.approve(address(hook), type(uint256).max);
            token.approve(address(swapRouter), type(uint256).max);
            vm.stopPrank();
        }
    }

    function _key(OrbitalV4Hook target, uint8 a, uint8 b) internal view returns (PoolKey memory) {
        (uint8 low, uint8 high) = a < b ? (a, b) : (b, a);
        return PoolKey({
            currency0: currencies[low],
            currency1: currencies[high],
            fee: poolFee,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(target))
        });
    }

    function _swapOn(OrbitalV4Hook target, uint8 input, uint8 output, uint256 amountIn, bytes memory hookData)
        internal
    {
        bool zeroForOne = input < output;
        swapRouter.swap(
            _key(target, input, output),
            SwapParams({
                zeroForOne: zeroForOne,
                // Test amounts are far below int256.max.
                // forge-lint: disable-next-line(unsafe-typecast)
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: zeroForOne ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            hookData
        );
    }

    function _swapAndMeasure(uint8 input, uint8 output, uint256 amountIn, bytes memory hookData)
        internal
        returns (uint256 paid, uint256 received)
    {
        MockERC20 tokenIn = MockERC20(Currency.unwrap(currencies[input]));
        MockERC20 tokenOut = MockERC20(Currency.unwrap(currencies[output]));
        uint256 inBefore = tokenIn.balanceOf(address(this));
        uint256 outBefore = tokenOut.balanceOf(address(this));
        _swapOn(hook, input, output, amountIn, hookData);
        paid = inBefore - tokenIn.balanceOf(address(this));
        received = tokenOut.balanceOf(address(this)) - outBefore;
    }

    function _expectHookRevert(address target, bytes4 callback, bytes memory reason) internal {
        vm.expectRevert(
            abi.encodeWithSelector(
                CustomRevert.WrappedError.selector,
                target,
                callback,
                reason,
                abi.encodeWithSelector(Hooks.HookCallFailed.selector)
            )
        );
    }

    function _assertSolvent() internal view {
        (uint256[4] memory custody, uint256[4] memory required) = hook.solvency();
        for (uint256 i; i < 4; ++i) {
            assertGe(custody[i], required[i]);
            assertEq(custody[i], manager.balanceOf(address(hook), currencies[i].toId()));
        }
    }

    function _indexOf(string memory symbol) internal view returns (uint8) {
        for (uint8 i; i < 4; ++i) {
            if (keccak256(bytes(MockERC20(Currency.unwrap(currencies[i])).symbol())) == keccak256(bytes(symbol))) {
                return i;
            }
        }
        revert("unknown symbol");
    }

    function _scale(uint256 index) internal view returns (uint256) {
        return 10 ** (18 - decimals[index]);
    }
}
