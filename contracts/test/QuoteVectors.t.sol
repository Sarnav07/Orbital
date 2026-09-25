// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {SegmentedTorus4} from "../src/math/SegmentedTorus4.sol";
import {RangeLiquidity4} from "../src/math/RangeLiquidity4.sol";
import {Torus4} from "../src/math/Torus4.sol";

contract SegmentedSwapHarness {
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

    function attribute(Torus4.State memory state, SegmentedTorus4.Tick[] memory ticks, uint256[4] memory reserves)
        external
        pure
        returns (RangeLiquidity4.Attribution[] memory)
    {
        return RangeLiquidity4.attribute(state, ticks, reserves);
    }
}

/// @notice Cross-language differential: the BigInt simulator generated these vectors
///         (packages/simulator/scripts/generate-vectors.mjs); Solidity must match exactly.
contract QuoteVectorsTest is Test {
    string private constant PATH = "../packages/fixtures/quote-vectors-v1.json";

    function testSolidityMatchesBigIntVectorsExactly() public {
        SegmentedSwapHarness harness = new SegmentedSwapHarness();
        string memory json = vm.readFile(PATH);
        assertEq(vm.parseJsonUint(json, ".version"), 1);

        SegmentedTorus4.Tick[] memory ticks = new SegmentedTorus4.Tick[](_count(json, ".ticks"));
        for (uint256 i; i < ticks.length; ++i) {
            string memory prefix = string.concat(".ticks[", vm.toString(i), "]");
            ticks[i] = SegmentedTorus4.Tick({
                radius: vm.parseJsonUint(json, string.concat(prefix, ".radius")),
                k: vm.parseJsonUint(json, string.concat(prefix, ".k")),
                isInterior: true
            });
        }
        uint256[4] memory reserves = _four(vm.parseJsonUintArray(json, ".initialReserves"));
        Torus4.State memory state = _aggregate(ticks);

        uint256 count = _count(json, ".actions");
        assertGt(count, 0);
        for (uint256 a; a < count; ++a) {
            string memory prefix = string.concat(".actions[", vm.toString(a), "]");
            // Indices are 0..3 in the fixture.
            // forge-lint: disable-next-line(unsafe-typecast)
            uint8 input = uint8(vm.parseJsonUint(json, string.concat(prefix, ".input")));
            // forge-lint: disable-next-line(unsafe-typecast)
            uint8 output = uint8(vm.parseJsonUint(json, string.concat(prefix, ".output")));
            uint256 amountIn = vm.parseJsonUint(json, string.concat(prefix, ".amountIn"));

            SegmentedTorus4.Result memory result = harness.swap(state, ticks, reserves, input, output, amountIn);

            assertEq(result.amountOut, vm.parseJsonUint(json, string.concat(prefix, ".amountOut")), "amountOut");
            assertEq(result.crossings, vm.parseJsonUint(json, string.concat(prefix, ".crossings")), "crossings");
            assertEq(result.interiorBitmap, vm.parseJsonUint(json, string.concat(prefix, ".interiorBitmap")), "bitmap");
            uint256[4] memory expected = _four(vm.parseJsonUintArray(json, string.concat(prefix, ".reserves")));
            for (uint256 i; i < 4; ++i) {
                assertEq(result.reserves[i], expected[i], "reserves");
            }

            reserves = result.reserves;
            state = result.state;
            for (uint256 i; i < ticks.length; ++i) {
                ticks[i].isInterior = result.interiorBitmap & (uint256(1) << i) != 0;
            }
            _assertAttribution(harness, json, prefix, state, ticks, reserves);
        }
    }

    /// @dev The BigInt port of RangeLiquidity4.attribute must agree to the wei after every step.
    function _assertAttribution(
        SegmentedSwapHarness harness,
        string memory json,
        string memory prefix,
        Torus4.State memory state,
        SegmentedTorus4.Tick[] memory ticks,
        uint256[4] memory reserves
    ) private view {
        RangeLiquidity4.Attribution[] memory ranges = harness.attribute(state, ticks, reserves);
        assertEq(ranges.length, _count(json, string.concat(prefix, ".attribution")), "range count");
        for (uint256 r; r < ranges.length; ++r) {
            string memory range = string.concat(prefix, ".attribution[", vm.toString(r), "]");
            assertEq(
                ranges[r].virtualOffset, vm.parseJsonUint(json, string.concat(range, ".virtualOffset")), "virtualOffset"
            );
            uint256[4] memory coordinates = _four(vm.parseJsonUintArray(json, string.concat(range, ".coordinates")));
            uint256[4] memory inventory = _four(vm.parseJsonUintArray(json, string.concat(range, ".realInventory")));
            for (uint256 i; i < 4; ++i) {
                assertEq(ranges[r].coordinates[i], coordinates[i], "coordinate");
                assertEq(ranges[r].realInventory[i], inventory[i], "realInventory");
            }
        }
    }

    function _count(string memory json, string memory key) private view returns (uint256 count) {
        while (vm.keyExistsJson(json, string.concat(key, "[", vm.toString(count), "]"))) {
            ++count;
        }
    }

    function _four(uint256[] memory values) private pure returns (uint256[4] memory result) {
        require(values.length == 4, "need four values");
        for (uint256 i; i < 4; ++i) {
            result[i] = values[i];
        }
    }

    function _aggregate(SegmentedTorus4.Tick[] memory ticks) private pure returns (Torus4.State memory state) {
        for (uint256 i; i < ticks.length; ++i) {
            state.rInterior += ticks[i].radius;
        }
    }
}
