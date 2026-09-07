// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Sphere4} from "../src/math/Sphere4.sol";
import {Torus4} from "../src/math/Torus4.sol";

contract Torus4Harness {
    function quote(Torus4.State memory state, uint256[4] memory reserves, uint8 input, uint8 output, uint256 amountIn)
        external
        pure
        returns (uint256)
    {
        return Torus4.quoteExactIn(state, reserves, input, output, amountIn);
    }

    function residual(Torus4.State memory state, uint256[4] memory reserves) external pure returns (int256) {
        return Torus4.residual(state, reserves);
    }

    function isValid(Torus4.State memory state, uint256[4] memory reserves) external pure returns (bool) {
        return Torus4.isInvariant(state, reserves);
    }
}

contract Torus4Test {
    uint256 private constant WAD = 1e18;
    Torus4Harness private harness = new Torus4Harness();

    function testInteriorSphereQuote() public pure {
        Torus4.State memory state = Torus4.State({rInterior: 200 * WAD, kBoundary: 0, sBoundary: 0});
        uint256[4] memory reserves = [uint256(100 * WAD), 100 * WAD, 100 * WAD, 100 * WAD];
        uint256 amountOut = Torus4.quoteExactIn(state, reserves, 0, 1, 80 * WAD);
        assertApproxEqAbs(amountOut, 40 * WAD, 2);
        reserves[0] += 80 * WAD;
        reserves[1] -= amountOut;
        assert(Torus4.isInvariant(state, reserves));
    }

    function testBoundaryAggregateQuoteMatchesReferenceFixture() public pure {
        // Reference fixture after range (r=100, k/r=1.10) is trapped at its
        // boundary while the r=100, k/r=1.30 range remains interior.
        Sphere4.TickGeometry memory trapped = Sphere4.tick(100 * WAD, 110 * WAD);
        Torus4.State memory state =
            Torus4.State({rInterior: 100 * WAD, kBoundary: 110 * WAD, sBoundary: trapped.boundaryRadius});
        uint256[4] memory reserves = [uint256(180 * WAD), 60 * WAD, 100 * WAD, 100 * WAD];
        assert(Torus4.isInvariant(state, reserves));
        uint256 amountOut = Torus4.quoteExactIn(state, reserves, 0, 1, 20 * WAD);
        assertApproxEqAbs(amountOut, 123_552_802_932_248_591, 1_000_000_000);
        reserves[0] += 20 * WAD;
        reserves[1] -= amountOut;
        assert(Torus4.isInvariant(state, reserves));
    }

    function testFuzzInteriorQuotesPreserveBoundedInvariant(uint64 seed) public pure {
        Torus4.State memory state = Torus4.State({rInterior: 200 * WAD, kBoundary: 0, sBoundary: 0});
        uint256[4] memory reserves = [uint256(100 * WAD), 100 * WAD, 100 * WAD, 100 * WAD];
        uint256 amountIn = (uint256(seed) % 75 + 1) * WAD;
        uint256 amountOut = Torus4.quoteExactIn(state, reserves, 0, 1, amountIn);
        assert(amountOut > 0 && amountOut < reserves[1]);
        reserves[0] += amountIn;
        reserves[1] -= amountOut;
        assert(Torus4.isInvariant(state, reserves));
    }

    function testRejectsInvalidOrUnsupportedQuotes() public {
        Torus4.State memory interior = Torus4.State({rInterior: 200 * WAD, kBoundary: 0, sBoundary: 0});
        Torus4.State memory allBoundary = Torus4.State({rInterior: 0, kBoundary: 110 * WAD, sBoundary: 1});
        uint256[4] memory peg = [uint256(100 * WAD), 100 * WAD, 100 * WAD, 100 * WAD];
        _expect(abi.encodeCall(harness.quote, (allBoundary, peg, 0, 1, WAD)), Torus4.AllBoundaryUnsupported.selector);
        _expect(abi.encodeCall(harness.quote, (interior, peg, 0, 0, WAD)), Torus4.SameAsset.selector);
        _expect(abi.encodeCall(harness.quote, (interior, peg, 4, 1, WAD)), Torus4.InvalidAssetIndex.selector);
        _expect(abi.encodeCall(harness.quote, (interior, peg, 0, 1, 0)), Torus4.ZeroAmountIn.selector);
        uint256[4] memory offInvariant = [uint256(1 * WAD), WAD, WAD, WAD];
        _expect(abi.encodeCall(harness.quote, (interior, offInvariant, 0, 1, WAD)), Torus4.InvalidState.selector);
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
