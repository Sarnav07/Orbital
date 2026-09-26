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

    /// Formerly SA-1: the 512-bit branch was checked arithmetic and reverted with Panic(0x11)
    /// instead of wrapping. It must now equal FullMath wherever the result fits in 256 bits.
    function testWideProductBranchMatchesFullMath() public view {
        uint256 x = 2 ** 200;
        uint256 y = 2 ** 100 + 12_345;
        uint256 denominator = 2 ** 90 + 7;
        assertEq(harness.mulDivDown(x, y, denominator), FullMath.mulDiv(x, y, denominator));
    }

    function testFuzzWideProductsMatchFullMath(uint256 x, uint256 y, uint256 denominator) public view {
        x = bound(x, 2 ** 128, type(uint256).max);
        y = bound(y, 2 ** 128, type(uint256).max);
        denominator = bound(denominator, 1, type(uint256).max);
        (bool fits, uint256 expected) = _fullMath(x, y, denominator);
        if (!fits) return;
        assertEq(harness.mulDivDown(x, y, denominator), expected);
    }

    function _fullMath(uint256 x, uint256 y, uint256 denominator) private view returns (bool, uint256) {
        try this.fullMathExternal(x, y, denominator) returns (uint256 value) {
            return (true, value);
        } catch {
            return (false, 0);
        }
    }

    function fullMathExternal(uint256 x, uint256 y, uint256 denominator) external pure returns (uint256) {
        return FullMath.mulDiv(x, y, denominator);
    }
}
