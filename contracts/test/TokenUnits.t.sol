// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {TokenUnits} from "../src/math/TokenUnits.sol";

contract TokenUnitsHarness {
    function toWad(uint256 raw, uint8 decimals) external pure returns (uint256) {
        return TokenUnits.toWad(raw, decimals);
    }

    function fromWadDown(uint256 wad, uint8 decimals) external pure returns (uint256) {
        return TokenUnits.fromWadDown(wad, decimals);
    }

    function fromWadUp(uint256 wad, uint8 decimals) external pure returns (uint256) {
        return TokenUnits.fromWadUp(wad, decimals);
    }
}

contract TokenUnitsTest {
    TokenUnitsHarness private harness = new TokenUnitsHarness();

    function testStablecoinUnits() public pure {
        assert(TokenUnits.toWad(1_000_000, 6) == 1e18);
        assert(TokenUnits.toWad(1e18, 18) == 1e18);
        assert(TokenUnits.toWad(1, 0) == 1e18);
    }

    function testRoundingDirection() public pure {
        assert(TokenUnits.fromWadDown(1e18 + 1, 6) == 1_000_000);
        assert(TokenUnits.fromWadUp(1e18 + 1, 6) == 1_000_001);
        assert(TokenUnits.fromWadUp(1e18, 6) == 1_000_000);
        assert(TokenUnits.fromWadDown(1, 6) == 0);
        assert(TokenUnits.fromWadUp(1, 6) == 1);
    }

    function testZero() public pure {
        for (uint8 decimals; decimals <= 18; ++decimals) {
            assert(TokenUnits.toWad(0, decimals) == 0);
            assert(TokenUnits.fromWadDown(0, decimals) == 0);
            assert(TokenUnits.fromWadUp(0, decimals) == 0);
        }
    }

    function testMaximumWad() public pure {
        uint256 maximum = type(uint256).max;
        assert(TokenUnits.toWad(maximum, 18) == maximum);
        assert(TokenUnits.fromWadUp(maximum, 18) == maximum);
        assert(TokenUnits.fromWadUp(maximum, 6) == maximum / 1e12 + 1);
    }

    function testFuzzRawRoundTrip(uint256 seed, uint8 decimalSeed) public pure {
        uint8 decimals = decimalSeed % 19;
        uint256 maximum = type(uint256).max / TokenUnits.scale(decimals);
        uint256 raw = seed > maximum ? maximum : seed;
        uint256 wad = TokenUnits.toWad(raw, decimals);
        assert(TokenUnits.fromWadDown(wad, decimals) == raw);
        assert(TokenUnits.fromWadUp(wad, decimals) == raw);
    }

    function testFuzzRoundingBounds(uint256 wad, uint8 decimalSeed) public pure {
        uint8 decimals = decimalSeed % 19;
        uint256 factor = TokenUnits.scale(decimals);
        uint256 down = TokenUnits.fromWadDown(wad, decimals);
        uint256 up = TokenUnits.fromWadUp(wad, decimals);
        assert(down * factor <= wad);
        assert(wad - down * factor < factor);
        assert(up - down == (wad % factor == 0 ? 0 : 1));
        // Avoid multiplying up by factor: the mathematical result may exceed uint256.
        if (wad > 0) assert((up - 1) * factor < wad);
    }

    function testFuzzRejectUnsupportedDecimals(uint8 seed) public {
        uint8 decimals = uint8(19 + uint256(seed) % 237);
        _expectError(abi.encodeCall(harness.toWad, (0, decimals)), TokenUnits.UnsupportedDecimals.selector);
        _expectError(abi.encodeCall(harness.fromWadDown, (0, decimals)), TokenUnits.UnsupportedDecimals.selector);
        _expectError(abi.encodeCall(harness.fromWadUp, (0, decimals)), TokenUnits.UnsupportedDecimals.selector);
    }

    function testFuzzOverflowBoundary(uint8 seed) public {
        uint8 decimals = seed % 18;
        uint256 factor = TokenUnits.scale(decimals);
        uint256 maximum = type(uint256).max / factor;
        assert(harness.toWad(maximum, decimals) == maximum * factor);
        _expectError(abi.encodeCall(harness.toWad, (maximum + 1, decimals)), TokenUnits.AmountOverflow.selector);
    }

    function _expectError(bytes memory callData, bytes4 selector) private {
        (bool success, bytes memory result) = address(harness).call(callData);
        assert(!success);
        assert(result.length >= 4);
        // Read only the four-byte error selector after checking the response length.
        // forge-lint: disable-next-line(unsafe-typecast)
        assert(bytes4(result) == selector);
    }
}
