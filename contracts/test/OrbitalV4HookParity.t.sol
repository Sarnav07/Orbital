// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {console2} from "forge-std/console2.sol";

import {Torus4} from "../src/math/Torus4.sol";
import {OrbitalTestBase} from "./utils/OrbitalTestBase.sol";

/// @notice With a zero fee and 18-decimal tokens, settlement through the real
///         PoolManager must equal the pure engine vectors to the wei.
contract OrbitalV4HookParityTest is OrbitalTestBase {
    string private constant PATH = "../packages/fixtures/quote-vectors-v1.json";

    function setUp() public {
        poolFee = 0;
        _deployManager();
        _deployTokens([uint8(18), 18, 18, 18]);
        hook = _deployHook(address(this));
        _initializePools(hook);
        _fund(address(this));
        hook.seed(address(this));
    }

    function testManagerSettlementMatchesSharedVectorsExactly() public {
        string memory json = vm.readFile(PATH);
        for (uint256 a; vm.keyExistsJson(json, string.concat(".actions[", vm.toString(a), "]")); ++a) {
            string memory prefix = string.concat(".actions[", vm.toString(a), "]");
            // Fixture indices are 0..3.
            // forge-lint: disable-next-line(unsafe-typecast)
            uint8 input = uint8(vm.parseJsonUint(json, string.concat(prefix, ".input")));
            // forge-lint: disable-next-line(unsafe-typecast)
            uint8 output = uint8(vm.parseJsonUint(json, string.concat(prefix, ".output")));
            uint256 amountIn = vm.parseJsonUint(json, string.concat(prefix, ".amountIn"));

            (uint256 paid, uint256 received) = _swapAndMeasure(input, output, amountIn, "");

            assertEq(paid, amountIn);
            assertEq(received, vm.parseJsonUint(json, string.concat(prefix, ".amountOut")));
            uint256[] memory expected = vm.parseJsonUintArray(json, string.concat(prefix, ".reserves"));
            uint256[4] memory actual = hook.reserves();
            uint256 bitmap = vm.parseJsonUint(json, string.concat(prefix, ".interiorBitmap"));
            for (uint256 i; i < 4; ++i) {
                assertEq(actual[i], expected[i]);
            }
            for (uint256 i; i < 3; ++i) {
                assertEq(hook.tickIsInterior(i), bitmap & (uint256(1) << i) != 0);
            }
            _assertSolvent();
        }
    }

    function testBoundaryRangeLiquidityRoundTrip() public {
        _swapAndMeasure(0, 2, 1_500_000 * WAD, "");
        assertFalse(hook.tickIsInterior(0));

        address lp = makeAddr("boundary-lp");
        _fund(lp);
        uint256 shares = hook.totalShares(0) / 100;
        uint256[4] memory quotedIn = hook.previewAddLiquidity(0, shares);
        vm.prank(lp);
        uint256[4] memory amountsIn = hook.addLiquidity(0, shares, quotedIn, block.timestamp);
        assertFalse(hook.tickIsInterior(0));
        assertTrue(Torus4.isInvariant(hook.state(), hook.reserves()));
        _assertSolvent();

        vm.prank(lp);
        uint256[4] memory amountsOut =
            hook.removeLiquidity(0, shares, hook.previewRemoveLiquidity(0, shares), block.timestamp);
        for (uint256 i; i < 4; ++i) {
            assertLe(amountsOut[i], amountsIn[i]);
            assertLe(amountsIn[i] - amountsOut[i], 3);
        }
        // A trapped range holds an off-peg basket: its deposit is not an equal split.
        assertTrue(amountsIn[0] != amountsIn[2]);
        _assertSolvent();
    }
}

/// @notice Gas through the PoolManager and PoolSwapTest router at demo scale.
contract OrbitalV4HookGasTest is OrbitalTestBase {
    function setUp() public {
        _deployManager();
        _deployTokens([uint8(6), 6, 18, 18]);
        hook = _deployHook(address(this));
        _initializePools(hook);
        _fund(address(this));
        hook.seed(address(this));
    }

    function testGasOrdinarySwap() public {
        uint256 used = _measure(0, 1, 1_000);
        console2.log("ordinary swap gas", used);
        assertLe(used, 1_600_000);
    }

    function testGasSingleCrossingSwap() public {
        uint256 used = _measure(0, 2, 1_500_000);
        assertFalse(hook.tickIsInterior(0));
        console2.log("single-crossing swap gas", used);
        assertLe(used, 4_000_000);
    }

    function testGasDoubleCrossingSwap() public {
        uint256 used = _measure(0, 2, 3_000_000);
        assertFalse(hook.tickIsInterior(0));
        assertFalse(hook.tickIsInterior(1));
        console2.log("double-crossing swap gas", used);
        assertLe(used, 6_500_000);
    }

    function testGasLiquidityAddAndRemove() public {
        uint256 shares = hook.totalShares(1) / 100;
        uint256[4] memory quoted = hook.previewAddLiquidity(1, shares);
        uint256 start = gasleft();
        hook.addLiquidity(1, shares, quoted, block.timestamp);
        uint256 addUsed = start - gasleft();
        uint256[4] memory minOut = hook.previewRemoveLiquidity(1, shares);
        start = gasleft();
        hook.removeLiquidity(1, shares, minOut, block.timestamp);
        uint256 removeUsed = start - gasleft();
        console2.log("add liquidity gas", addUsed);
        console2.log("remove liquidity gas", removeUsed);
        assertLe(addUsed, 1_500_000);
        assertLe(removeUsed, 1_500_000);
    }

    function _measure(uint8 input, uint8 output, uint256 units) private returns (uint256 used) {
        uint256 amountIn = units * 10 ** decimals[input];
        uint256 start = gasleft();
        _swapOn(hook, input, output, amountIn, "");
        used = start - gasleft();
    }
}
