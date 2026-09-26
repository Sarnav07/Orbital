// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {FixedPointMath} from "../src/math/FixedPointMath.sol";
import {SegmentedTorus4} from "../src/math/SegmentedTorus4.sol";
import {Torus4} from "../src/math/Torus4.sol";
import {OrbitalDemoConfig} from "../script/OrbitalDeployBase.sol";
import {OrbitalTestBase} from "./utils/OrbitalTestBase.sol";

/// @notice M-1 through the real PoolManager: a swap that ends exactly on a range's plane must
///         not leave that range stuck, and LP withdrawals must keep working afterwards.
contract OrbitalV4HookBoundaryTest is OrbitalTestBase {
    using FixedPointMath for uint256;

    uint256 private constant FEE_DENOMINATOR = 1_000_000;
    uint8 private dai;
    uint8 private frax;

    function setUp() public {
        _deployManager();
        _deployTokens([uint8(6), 6, 18, 18]);
        hook = _deployHook(address(this));
        _initializePools(hook);
        _fund(address(this));
        hook.seed(address(this));
        // Both 18-decimal coins: 1-wei input granularity makes an exact landing easy to hit.
        uint8[2] memory wide;
        uint256 found;
        for (uint8 i; i < 4; ++i) {
            if (decimals[i] == 18) wide[found++] = i;
        }
        (dai, frax) = (wide[0], wide[1]);
    }

    function _alphaAfter(uint8 input, uint8 output, uint256 net) private view returns (uint256) {
        Torus4.State memory state = hook.state();
        uint256[4] memory reserves = hook.reserves();
        uint256 out = Torus4.quoteExactIn(state, reserves, input, output, net);
        reserves[input] += net;
        reserves[output] -= out;
        uint256 sum = reserves[0] + reserves[1] + reserves[2] + reserves[3];
        return (sum / 2 - state.kBoundary).divWadDown(state.rInterior);
    }

    /// Smallest gross 18-decimal input whose net quote reaches `target` alpha.
    function _grossLandingOn(uint8 input, uint8 output, uint256 target, bool rising) private view returns (uint256) {
        uint256 low = 1;
        uint256 high = 2_000_000 * WAD;
        while (low < high) {
            uint256 middle = low + (high - low) / 2;
            uint256 net = middle - (middle * FEE + FEE_DENOMINATOR - 1) / FEE_DENOMINATOR;
            uint256 alpha = _alphaAfter(input, output, net);
            if (rising ? alpha >= target : alpha <= target) high = middle;
            else low = middle + 1;
        }
        return low;
    }

    uint24 private constant FEE = OrbitalDemoConfig.FEE;

    function _lambda0() private view returns (uint256) {
        SegmentedTorus4.Tick memory tick = hook.tickAt(0);
        return tick.k.divWadDown(tick.radius);
    }

    function testRangeRecoversAfterASwapThatEndedOnItsPlane() public {
        uint256 gross = _grossLandingOn(dai, frax, _lambda0(), true);
        _swapOn(hook, dai, frax, gross, "");
        assertFalse(hook.tickIsInterior(0), "range 0 reached its boundary");

        _swapOn(hook, frax, dai, 1_000 * WAD, "");
        assertTrue(hook.tickIsInterior(0), "range 0 is back inside its band");
        _assertSolvent();
    }

    function testLpWithdrawalsKeepWorkingAfterReenteringOnThePlane() public {
        _swapOn(hook, dai, frax, 1_000_000 * WAD, "");
        assertFalse(hook.tickIsInterior(0));
        uint256 gross = _grossLandingOn(frax, dai, _lambda0(), false);
        _swapOn(hook, frax, dai, gross, "");
        assertTrue(hook.tickIsInterior(0));

        // Rising again must trap range 0 at its plane instead of trading it past its bound.
        _swapOn(hook, dai, frax, 1_000_000 * WAD, "");
        assertFalse(hook.tickIsInterior(0), "range 0 must not trade past its bound");
        hook.rangeAttributions();

        uint256 shares = hook.sharesOf(1, address(this)) / 100;
        uint256[4] memory none;
        hook.removeLiquidity(1, shares, none, block.timestamp);
        _assertSolvent();
    }
}
