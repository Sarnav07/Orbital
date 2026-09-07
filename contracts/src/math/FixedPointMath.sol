// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Bounded WAD arithmetic used by the four-asset geometry prototype.
library FixedPointMath {
    uint256 internal constant WAD = 1e18;

    error DivisionByZero();
    error MulDivOverflow();

    function mulWadDown(uint256 x, uint256 y) internal pure returns (uint256) {
        return mulDivDown(x, y, WAD);
    }

    function divWadDown(uint256 x, uint256 y) internal pure returns (uint256) {
        return mulDivDown(x, WAD, y);
    }

    /// @notice Returns floor(x * y / denominator) with a 512-bit intermediate.
    function mulDivDown(uint256 x, uint256 y, uint256 denominator) internal pure returns (uint256 result) {
        if (denominator == 0) revert DivisionByZero();
        uint256 productLow;
        uint256 productHigh;
        assembly ("memory-safe") {
            let modulus := mulmod(x, y, not(0))
            productLow := mul(x, y)
            productHigh := sub(sub(modulus, productLow), lt(modulus, productLow))
        }
        if (productHigh == 0) return productLow / denominator;
        if (denominator <= productHigh) revert MulDivOverflow();

        uint256 remainder;
        assembly ("memory-safe") {
            remainder := mulmod(x, y, denominator)
            productHigh := sub(productHigh, gt(remainder, productLow))
            productLow := sub(productLow, remainder)
        }
        uint256 twos = denominator & (0 - denominator);
        assembly ("memory-safe") {
            denominator := div(denominator, twos)
            productLow := div(productLow, twos)
            twos := add(div(sub(0, twos), twos), 1)
            productLow := or(productLow, mul(productHigh, twos))
        }
        uint256 inverse = (3 * denominator) ^ 2;
        unchecked {
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
        }
        return productLow * inverse;
    }

    /// @notice Integer square root, rounded down.
    function sqrt(uint256 x) internal pure returns (uint256 result) {
        if (x == 0) return 0;
        uint256 z = 1;
        uint256 t = x;
        if (t >> 128 > 0) {
            t >>= 128;
            z <<= 64;
        }
        if (t >> 64 > 0) {
            t >>= 64;
            z <<= 32;
        }
        if (t >> 32 > 0) {
            t >>= 32;
            z <<= 16;
        }
        if (t >> 16 > 0) {
            t >>= 16;
            z <<= 8;
        }
        if (t >> 8 > 0) {
            t >>= 8;
            z <<= 4;
        }
        if (t >> 4 > 0) {
            t >>= 4;
            z <<= 2;
        }
        if (t >> 2 > 0) z <<= 1;
        unchecked {
            for (uint256 i; i < 7; ++i) {
                z = (z + x / z) >> 1;
            }
        }
        return z < x / z ? z : x / z;
    }

    /// @notice Returns floor(sqrt(x / WAD) * WAD), equivalently floor(sqrt(x * WAD)).
    function sqrtWad(uint256 x) internal pure returns (uint256) {
        if (x > type(uint256).max / WAD) revert MulDivOverflow();
        return sqrt(x * WAD);
    }
}
