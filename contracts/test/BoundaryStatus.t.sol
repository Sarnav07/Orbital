// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {FixedPointMath} from "../src/math/FixedPointMath.sol";
import {RangeLiquidity4} from "../src/math/RangeLiquidity4.sol";
import {SegmentedTorus4} from "../src/math/SegmentedTorus4.sol";
import {Torus4} from "../src/math/Torus4.sol";

/// @notice A range's interior/boundary status must always agree with where the book is.
/// @dev Normalized alpha below a range's k/r means the range is interior; above it, boundary.
///      The dangerous case is a trade that ends exactly on a range's boundary plane: the next
///      trade starts at alpha == k/r and must still flip the range when it moves away.
contract BoundaryStatusTest is Test {
    using FixedPointMath for uint256;

    uint256 internal constant WAD = 1e18;
    uint256 internal constant RADIUS = 10_000_000 * WAD;
    uint8 internal constant IN = 2; // an 18-decimal coin: 1-wei input granularity
    uint8 internal constant OUT = 3;

    function _ticks() internal pure returns (SegmentedTorus4.Tick[] memory ticks) {
        ticks = new SegmentedTorus4.Tick[](3);
        ticks[0] = SegmentedTorus4.Tick({radius: RADIUS, k: RADIUS * 1001 / 1000, isInterior: true});
        ticks[1] = SegmentedTorus4.Tick({radius: RADIUS, k: RADIUS * 1004 / 1000, isInterior: true});
        ticks[2] = SegmentedTorus4.Tick({radius: RADIUS, k: RADIUS * 1050 / 1000, isInterior: true});
    }

    function _start() internal pure returns (Torus4.State memory state, uint256[4] memory reserves) {
        state = Torus4.State({rInterior: 3 * RADIUS, kBoundary: 0, sBoundary: 0});
        uint256 equal = RADIUS * 3 / 2;
        reserves = [equal, equal, equal, equal];
    }

    /// Same normalization as SegmentedTorus4._alphaNormalized.
    function _alpha(Torus4.State memory state, uint256[4] memory reserves) internal pure returns (uint256) {
        uint256 sum = reserves[0] + reserves[1] + reserves[2] + reserves[3];
        return (sum / 2 - state.kBoundary).divWadDown(state.rInterior);
    }

    function _lambda(SegmentedTorus4.Tick memory tick) internal pure returns (uint256) {
        return tick.k.divWadDown(tick.radius);
    }

    function _alphaAfterFullQuote(
        Torus4.State memory state,
        uint256[4] memory reserves,
        uint8 input,
        uint8 output,
        uint256 amountIn
    ) internal pure returns (uint256) {
        uint256 out = Torus4.quoteExactIn(state, reserves, input, output, amountIn);
        uint256[4] memory next = [reserves[0], reserves[1], reserves[2], reserves[3]];
        next[input] += amountIn;
        next[output] -= out;
        return _alpha(state, next);
    }

    /// Smallest input whose fixed-partition quote reaches `target` alpha (monotone in the input).
    function _amountLandingOn(
        Torus4.State memory state,
        uint256[4] memory reserves,
        uint8 input,
        uint8 output,
        uint256 target,
        bool rising,
        uint256 high
    ) internal pure returns (uint256 low) {
        low = 1;
        while (low < high) {
            uint256 middle = low + (high - low) / 2;
            uint256 alpha = _alphaAfterFullQuote(state, reserves, input, output, middle);
            bool reached = rising ? alpha >= target : alpha <= target;
            if (reached) high = middle;
            else low = middle + 1;
        }
    }

    function _mask(SegmentedTorus4.Tick[] memory ticks, uint256 bitmap) internal pure {
        for (uint256 i; i < ticks.length; ++i) {
            ticks[i].isInterior = bitmap & (uint256(1) << i) != 0;
        }
    }

    function _assertConsistent(
        SegmentedTorus4.Tick[] memory ticks,
        Torus4.State memory state,
        uint256[4] memory reserves,
        string memory where
    ) internal pure {
        uint256 alpha = _alpha(state, reserves);
        for (uint256 i; i < ticks.length; ++i) {
            uint256 lambda = _lambda(ticks[i]);
            if (ticks[i].isInterior) {
                assertLe(alpha, lambda, string.concat(where, ": interior range is past its boundary"));
            } else {
                assertGe(alpha, lambda, string.concat(where, ": boundary range is back inside its band"));
            }
        }
    }

    /// Rising trade lands exactly on range 0's plane, then a small reverse trade moves back inside.
    function testReverseAfterExactLandingRestoresTheRange() public pure {
        SegmentedTorus4.Tick[] memory ticks = _ticks();
        (Torus4.State memory state, uint256[4] memory reserves) = _start();
        uint256 lambda = _lambda(ticks[0]);

        uint256 amountIn = _amountLandingOn(state, reserves, IN, OUT, lambda, true, 5_000_000 * WAD);
        assertEq(_alphaAfterFullQuote(state, reserves, IN, OUT, amountIn), lambda, "no exact landing found");

        SegmentedTorus4.Result memory landed = SegmentedTorus4.swapExactIn(state, ticks, reserves, IN, OUT, amountIn);
        assertEq(landed.crossings, 1);
        assertEq(landed.interiorBitmap, 6, "range 0 should be at its boundary");

        ticks = _ticks();
        _mask(ticks, landed.interiorBitmap);
        SegmentedTorus4.Result memory back =
            SegmentedTorus4.swapExactIn(landed.state, ticks, landed.reserves, OUT, IN, 1_000 * WAD);
        _mask(ticks, back.interiorBitmap);
        _assertConsistent(ticks, back.state, back.reserves, "after reverse trade");
    }

    /// Falling trade lands exactly on range 0's plane from outside, then the book rises again.
    function testRisingAfterExactReentryTrapsTheRangeAgain() public pure {
        SegmentedTorus4.Tick[] memory ticks = _ticks();
        (Torus4.State memory state, uint256[4] memory reserves) = _start();
        uint256 lambda = _lambda(ticks[0]);

        // Push well past range 0's boundary first (an ordinary crossing).
        SegmentedTorus4.Result memory out =
            SegmentedTorus4.swapExactIn(state, ticks, reserves, IN, OUT, 1_000_000 * WAD);
        assertEq(out.interiorBitmap, 6);
        ticks = _ticks();
        _mask(ticks, out.interiorBitmap);

        // Then return exactly to the plane from above.
        uint256 amountBack = _amountLandingOn(out.state, out.reserves, OUT, IN, lambda, false, 1_000_000 * WAD);
        assertEq(_alphaAfterFullQuote(out.state, out.reserves, OUT, IN, amountBack), lambda, "no exact landing found");
        SegmentedTorus4.Result memory reentered =
            SegmentedTorus4.swapExactIn(out.state, ticks, out.reserves, OUT, IN, amountBack);
        assertEq(reentered.interiorBitmap, 7, "range 0 should be interior again");

        ticks = _ticks();
        _mask(ticks, reentered.interiorBitmap);
        SegmentedTorus4.Result memory up =
            SegmentedTorus4.swapExactIn(reentered.state, ticks, reentered.reserves, IN, OUT, 200_000 * WAD);
        _mask(ticks, up.interiorBitmap);
        _assertConsistent(ticks, up.state, up.reserves, "after rising again");
    }

    /// Impact of a stale interior range: its real inventory goes negative, so per-range attribution
    /// (and with it every addLiquidity/removeLiquidity on the hook) reverts until someone trades back.
    function testAttributionSurvivesRisingAfterExactReentry() public {
        SegmentedTorus4.Tick[] memory ticks = _ticks();
        (Torus4.State memory state, uint256[4] memory reserves) = _start();
        uint256 lambda = _lambda(ticks[0]);
        SegmentedTorus4.Result memory out =
            SegmentedTorus4.swapExactIn(state, ticks, reserves, IN, OUT, 1_000_000 * WAD);
        ticks = _ticks();
        _mask(ticks, out.interiorBitmap);
        uint256 amountBack = _amountLandingOn(out.state, out.reserves, OUT, IN, lambda, false, 1_000_000 * WAD);
        SegmentedTorus4.Result memory reentered =
            SegmentedTorus4.swapExactIn(out.state, ticks, out.reserves, OUT, IN, amountBack);
        ticks = _ticks();
        _mask(ticks, reentered.interiorBitmap);
        SegmentedTorus4.Result memory up =
            SegmentedTorus4.swapExactIn(reentered.state, ticks, reentered.reserves, IN, OUT, 1_000_000 * WAD);
        _mask(ticks, up.interiorBitmap);
        this.attribute(up.state, ticks, up.reserves);
    }

    /// Any pair, either approach to range 0's plane, any follow-up size: status stays consistent
    /// with the book and attribution stays available.
    /// forge-config: default.fuzz.runs = 24
    /// forge-config: ci.fuzz.runs = 64
    function testFuzzExactLandingThenAnyTradeKeepsStatusConsistent(
        uint256 pairSeed,
        bool fromOutside,
        bool followUpward,
        uint256 sizeSeed
    ) public {
        // Both values are reduced modulo 4.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint8 input = uint8(pairSeed % 4);
        // forge-lint: disable-next-line(unsafe-typecast)
        uint8 output = uint8((input + 1 + (pairSeed / 4) % 3) % 4);
        SegmentedTorus4.Tick[] memory ticks = _ticks();
        (Torus4.State memory state, uint256[4] memory reserves) = _start();
        uint256 lambda = _lambda(ticks[0]);

        if (fromOutside) {
            SegmentedTorus4.Result memory out =
                SegmentedTorus4.swapExactIn(state, ticks, reserves, input, output, 1_000_000 * WAD);
            (state, reserves) = (out.state, out.reserves);
            ticks = _ticks();
            _mask(ticks, out.interiorBitmap);
            (input, output) = (output, input);
        }
        uint256 amount = _amountLandingOn(state, reserves, input, output, lambda, !fromOutside, 1_000_000 * WAD);
        vm.assume(_alphaAfterFullQuote(state, reserves, input, output, amount) == lambda);
        SegmentedTorus4.Result memory landed =
            SegmentedTorus4.swapExactIn(state, ticks, reserves, input, output, amount);
        _mask(ticks, landed.interiorBitmap);

        (uint8 nextIn, uint8 nextOut) = followUpward == !fromOutside ? (input, output) : (output, input);
        uint256 size = bound(sizeSeed, 1e15, 400_000 * WAD);
        SegmentedTorus4.Result memory next =
            SegmentedTorus4.swapExactIn(landed.state, ticks, landed.reserves, nextIn, nextOut, size);
        _mask(ticks, next.interiorBitmap);
        _assertConsistent(ticks, next.state, next.reserves, "after follow-up");
        this.attribute(next.state, ticks, next.reserves);
    }

    function attribute(Torus4.State memory state, SegmentedTorus4.Tick[] memory ticks, uint256[4] memory reserves)
        external
        pure
        returns (RangeLiquidity4.Attribution[] memory)
    {
        return RangeLiquidity4.attribute(state, ticks, reserves);
    }
}
