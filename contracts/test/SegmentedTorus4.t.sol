// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {SegmentedTorus4} from "../src/math/SegmentedTorus4.sol";
import {Sphere4} from "../src/math/Sphere4.sol";
import {Torus4} from "../src/math/Torus4.sol";

contract SegmentedTorus4Harness {
    function swap(
        Torus4.State memory state,
        SegmentedTorus4.Tick[] memory ticks,
        uint256[4] memory reserves,
        uint8 input,
        uint8 output,
        uint256 amountIn
    ) external pure returns (SegmentedTorus4.Result memory) {
        return SegmentedTorus4.swapExactIn(state, ticks, reserves, input, output, amountIn);
    }
}

contract SegmentedTorus4Test {
    uint256 private constant WAD = 1e18;
    SegmentedTorus4Harness private harness = new SegmentedTorus4Harness();

    function testTrapsFirstRangeAndContinues() public pure {
        SegmentedTorus4.Tick[] memory ticks = _twoRanges();
        Torus4.State memory state = Torus4.State({rInterior: 200 * WAD, kBoundary: 0, sBoundary: 0});
        uint256[4] memory reserves = [uint256(100 * WAD), 100 * WAD, 100 * WAD, 100 * WAD];
        SegmentedTorus4.Result memory result = SegmentedTorus4.swapExactIn(state, ticks, reserves, 0, 1, 100 * WAD);
        assert(result.crossings == 1);
        assert(result.interiorBitmap == 2);
        assert(result.state.rInterior == 100 * WAD);
        assert(result.state.kBoundary == 110 * WAD);
        assert(result.amountOut == 40_123_552_802_932_248_591);
        assert(Torus4.isInvariant(result.state, result.reserves));
    }

    function testWithinFirstSegmentDoesNotChangeTickState() public pure {
        SegmentedTorus4.Tick[] memory ticks = _twoRanges();
        Torus4.State memory state = Torus4.State({rInterior: 200 * WAD, kBoundary: 0, sBoundary: 0});
        uint256[4] memory reserves = [uint256(100 * WAD), 100 * WAD, 100 * WAD, 100 * WAD];
        SegmentedTorus4.Result memory result = SegmentedTorus4.swapExactIn(state, ticks, reserves, 0, 1, 60 * WAD);
        assert(result.crossings == 0);
        assert(result.interiorBitmap == 3);
        assertApproxEqAbs(result.amountOut, 35_646_599_662_505_362_781, 1_000_000_000);
        assert(Torus4.isInvariant(result.state, result.reserves));
    }

    function testReverseTradeRecoversRange() public pure {
        SegmentedTorus4.Tick[] memory ticks = _twoRanges();
        Torus4.State memory state = Torus4.State({rInterior: 200 * WAD, kBoundary: 0, sBoundary: 0});
        uint256[4] memory reserves = [uint256(100 * WAD), 100 * WAD, 100 * WAD, 100 * WAD];
        SegmentedTorus4.Result memory trapped = SegmentedTorus4.swapExactIn(state, ticks, reserves, 0, 1, 100 * WAD);
        // Recreate ticks from the returned bitmap; memory mutation is local to the first call.
        ticks = _twoRanges();
        ticks[0].isInterior = false;
        SegmentedTorus4.Result memory recovered =
            SegmentedTorus4.swapExactIn(trapped.state, ticks, trapped.reserves, 1, 0, 10 * WAD);
        assert(recovered.crossings == 1);
        assert(recovered.interiorBitmap == 3);
        assert(recovered.state.rInterior == 200 * WAD);
        assert(Torus4.isInvariant(recovered.state, recovered.reserves));
    }

    function testTiedRangesCrossTogether() public pure {
        SegmentedTorus4.Tick[] memory ticks = new SegmentedTorus4.Tick[](3);
        ticks[0] = SegmentedTorus4.Tick({radius: 50 * WAD, k: 55 * WAD, isInterior: true});
        ticks[1] = SegmentedTorus4.Tick({radius: 100 * WAD, k: 110 * WAD, isInterior: true});
        ticks[2] = SegmentedTorus4.Tick({radius: 100 * WAD, k: 130 * WAD, isInterior: true});
        Torus4.State memory state = Torus4.State({rInterior: 250 * WAD, kBoundary: 0, sBoundary: 0});
        uint256[4] memory reserves = [uint256(125 * WAD), 125 * WAD, 125 * WAD, 125 * WAD];
        SegmentedTorus4.Result memory result = SegmentedTorus4.swapExactIn(state, ticks, reserves, 0, 1, 120 * WAD);
        assert(result.crossings == 2);
        assert(result.interiorBitmap == 4);
        assert(Torus4.isInvariant(result.state, result.reserves));
    }

    function testAllBoundaryStateIsExplicitlyUnsupported() public {
        SegmentedTorus4.Tick[] memory ticks = new SegmentedTorus4.Tick[](1);
        ticks[0] = SegmentedTorus4.Tick({radius: 100 * WAD, k: 110 * WAD, isInterior: true});
        Torus4.State memory state = Torus4.State({rInterior: 100 * WAD, kBoundary: 0, sBoundary: 0});
        uint256[4] memory reserves = [uint256(50 * WAD), 50 * WAD, 50 * WAD, 50 * WAD];
        _expect(
            abi.encodeCall(harness.swap, (state, ticks, reserves, 0, 1, 80 * WAD)),
            SegmentedTorus4.AllBoundaryUnsupported.selector
        );
    }

    function testRejectsAggregateMismatchAndInvalidTicks() public {
        SegmentedTorus4.Tick[] memory ticks = _twoRanges();
        Torus4.State memory wrong = Torus4.State({rInterior: 100 * WAD, kBoundary: 0, sBoundary: 0});
        uint256[4] memory reserves = [uint256(100 * WAD), 100 * WAD, 100 * WAD, 100 * WAD];
        _expect(
            abi.encodeCall(harness.swap, (wrong, ticks, reserves, 0, 1, WAD)),
            SegmentedTorus4.AggregateMismatch.selector
        );

        SegmentedTorus4.Tick[] memory bad = new SegmentedTorus4.Tick[](1);
        bad[0] = SegmentedTorus4.Tick({radius: 100 * WAD, k: 100 * WAD, isInterior: true});
        Torus4.State memory state = Torus4.State({rInterior: 100 * WAD, kBoundary: 0, sBoundary: 0});
        _expect(
            abi.encodeCall(harness.swap, (state, bad, reserves, 0, 1, WAD)), SegmentedTorus4.InvalidTickSet.selector
        );
    }

    function _twoRanges() private pure returns (SegmentedTorus4.Tick[] memory ticks) {
        ticks = new SegmentedTorus4.Tick[](2);
        ticks[0] = SegmentedTorus4.Tick({radius: 100 * WAD, k: 110 * WAD, isInterior: true});
        ticks[1] = SegmentedTorus4.Tick({radius: 100 * WAD, k: 130 * WAD, isInterior: true});
    }

    function _expect(bytes memory callData, bytes4 selector) private {
        (bool success, bytes memory result) = address(harness).call(callData);
        assert(!success && result.length >= 4);
        // forge-lint: disable-next-line(unsafe-typecast)
        assert(bytes4(result) == selector);
    }

    function assertApproxEqAbs(uint256 actual, uint256 expected, uint256 tolerance) private pure {
        assert(actual >= expected ? actual - expected <= tolerance : expected - actual <= tolerance);
    }
}
