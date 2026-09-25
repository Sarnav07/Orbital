// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {FullMath} from "v4-core/libraries/FullMath.sol";

import {FixedPointMath} from "../src/math/FixedPointMath.sol";

contract FixedPointMathHarness {
    function mulDivDown(uint256 x, uint256 y, uint256 denominator) external pure returns (uint256) {
        return FixedPointMath.mulDivDown(x, y, denominator);
    }
}

/// @notice Differential checks of FixedPointMath.mulDivDown against Uniswap v4's FullMath.
contract FixedPointMathTest is Test {
    FixedPointMathHarness private harness = new FixedPointMathHarness();

    /// Every protocol call site keeps x*y below 2^256 (reserves <= 1e29 WAD, int128 amounts,
    /// Q128 fee growth). In that domain the result must equal FullMath exactly.
    function testFuzzMatchesFullMathWhenProductFitsIn256Bits(uint128 x, uint128 y, uint256 denominator) public view {
        denominator = bound(denominator, 1, type(uint256).max);
        assertEq(harness.mulDivDown(x, y, denominator), FullMath.mulDiv(x, y, denominator));
    }

    /// KNOWN ISSUE (docs/results/static-analysis.md, finding SA-1): the 512-bit branch uses
    /// checked arithmetic where the algorithm needs wrapping, so it reverts instead of
    /// returning FullMath's result. It fails closed and is unreachable within the protocol's
    /// bounds. The fix is to move that branch into `unchecked`, deferred to the next
    /// deployment so the deployed bytecode keeps matching source. When fixed, this test
    /// should assert equality with FullMath instead.
    function testKnownIssueWideProductBranchRevertsInsteadOfWrapping() public {
        uint256 x = 2 ** 200;
        uint256 y = 2 ** 100 + 12_345;
        uint256 denominator = 2 ** 90 + 7;
        assertGt(FullMath.mulDiv(x, y, denominator), 0);
        vm.expectRevert(abi.encodeWithSignature("Panic(uint256)", 0x11));
        harness.mulDivDown(x, y, denominator);
    }
}
