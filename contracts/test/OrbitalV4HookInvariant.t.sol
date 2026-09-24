// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {SwapParams} from "v4-core/types/PoolOperation.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";

import {OrbitalV4Hook} from "../src/OrbitalV4Hook.sol";
import {Torus4} from "../src/math/Torus4.sol";
import {OrbitalTestBase} from "./utils/OrbitalTestBase.sol";

/// @notice Random swaps across all pairs plus random range deposits and withdrawals.
contract OrbitalHandler is Test {
    OrbitalV4Hook internal immutable hook;
    PoolSwapTest internal immutable router;
    uint256 public swaps;
    uint256 public liquidityChanges;

    constructor(OrbitalV4Hook hook_, PoolSwapTest router_) {
        hook = hook_;
        router = router_;
        for (uint8 i; i < 4; ++i) {
            MockERC20 token = MockERC20(Currency.unwrap(hook.currencyAt(i)));
            token.mint(address(this), 1e12 * 10 ** token.decimals());
            token.approve(address(hook), type(uint256).max);
            token.approve(address(router), type(uint256).max);
        }
    }

    function swap(uint256 pairSeed, uint256 amountSeed) external {
        // Both values are reduced modulo 4.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint8 input = uint8(pairSeed % 4);
        // forge-lint: disable-next-line(unsafe-typecast)
        uint8 output = uint8((input + 1 + (pairSeed / 4) % 3) % 4);
        uint256 amountIn = bound(amountSeed, 1, 2_500_000) * 10 ** hook.decimalsAt(input);
        (uint8 low, uint8 high) = input < output ? (input, output) : (output, input);
        PoolKey memory key = PoolKey({
            currency0: hook.currencyAt(low),
            currency1: hook.currencyAt(high),
            fee: hook.poolFee(),
            tickSpacing: hook.poolTickSpacing(),
            hooks: IHooks(address(hook))
        });
        bool zeroForOne = input < output;
        // Bounded amounts are far below int256.max.
        // forge-lint: disable-next-line(unsafe-typecast)
        int256 exactIn = -int256(amountIn);
        // Unsupported regions (e.g. all-boundary continuation) revert atomically; that is allowed.
        try router.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: exactIn,
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        ) {
            ++swaps;
        } catch {}
    }

    function add(uint256 rangeSeed, uint256 fractionSeed) external {
        uint256 range = rangeSeed % hook.tickCount();
        uint256 shares = hook.totalShares(range) * bound(fractionSeed, 1, 500) / 10_000;
        try hook.previewAddLiquidity(range, shares) returns (uint256[4] memory quoted) {
            hook.addLiquidity(range, shares, quoted, block.timestamp);
            ++liquidityChanges;
        } catch {}
    }

    function remove(uint256 rangeSeed, uint256 fractionSeed) external {
        uint256 range = rangeSeed % hook.tickCount();
        uint256 shares = hook.sharesOf(range, address(this)) * bound(fractionSeed, 1, 10_000) / 10_000;
        if (shares == 0) return;
        uint256[4] memory quoted = hook.previewRemoveLiquidity(range, shares);
        hook.removeLiquidity(range, shares, quoted, block.timestamp);
        ++liquidityChanges;
    }

    function collect(uint256 rangeSeed) external {
        hook.collectFees(rangeSeed % hook.tickCount(), address(this));
    }
}

contract OrbitalV4HookInvariantTest is OrbitalTestBase {
    OrbitalHandler private handler;

    function setUp() public {
        _deployManager();
        _deployTokens([uint8(6), 6, 18, 18]);
        hook = _deployHook(address(this));
        _initializePools(hook);
        _fund(address(this));
        hook.seed(address(this));
        handler = new OrbitalHandler(hook, swapRouter);
        targetContract(address(handler));
    }

    /// @dev Guards against a vacuous campaign where every handler call was swallowed.
    function afterInvariant() external view {
        assertGt(handler.swaps() + handler.liquidityChanges(), 0);
    }

    /// forge-config: default.invariant.runs = 24
    /// forge-config: default.invariant.depth = 12
    /// forge-config: ci.invariant.runs = 96
    /// forge-config: ci.invariant.depth = 20
    function invariant_custodyCoversRedeemableInventoryAndFees() public view {
        (uint256[4] memory custody, uint256[4] memory required) = hook.solvency();
        for (uint256 i; i < 4; ++i) {
            assertGe(custody[i], required[i]);
        }
    }

    /// forge-config: default.invariant.runs = 24
    /// forge-config: default.invariant.depth = 12
    /// forge-config: ci.invariant.runs = 96
    /// forge-config: ci.invariant.depth = 20
    function invariant_reserveBookStaysOnTheAggregateTorus() public view {
        assertTrue(Torus4.isInvariant(hook.state(), hook.reserves()));
    }
}
