// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Converts raw token amounts to and from 18-decimal accounting units.
/// @dev Decimal normalization is not a price oracle: a depegged token is not worth $1.
library TokenUnits {
    error UnsupportedDecimals(uint8 decimals);
    error AmountOverflow();

    function scale(uint8 decimals) internal pure returns (uint256) {
        if (decimals > 18) revert UnsupportedDecimals(decimals);
        return 10 ** (18 - decimals);
    }

    /// @dev Exact conversion. Reject values that cannot be represented in WAD.
    function toWad(uint256 raw, uint8 decimals) internal pure returns (uint256) {
        uint256 factor = scale(decimals);
        if (raw > type(uint256).max / factor) revert AmountOverflow();
        return raw * factor;
    }

    /// @dev Round token payouts down; the caller must account for retained dust.
    function fromWadDown(uint256 wad, uint8 decimals) internal pure returns (uint256) {
        return wad / scale(decimals);
    }

    /// @dev Round required token inputs up without overflowing on wad + factor - 1.
    function fromWadUp(uint256 wad, uint8 decimals) internal pure returns (uint256) {
        uint256 factor = scale(decimals);
        return wad / factor + (wad % factor == 0 ? 0 : 1);
    }
}
