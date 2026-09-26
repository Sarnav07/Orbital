// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Currency} from "v4-core/types/Currency.sol";

import {OrbitalV4Hook} from "../src/OrbitalV4Hook.sol";
import {HookAddressMiner} from "../src/deploy/HookAddressMiner.sol";
import {SegmentedTorus4} from "../src/math/SegmentedTorus4.sol";
import {OrbitalDemoConfig} from "../script/OrbitalDeployBase.sol";
import {OrbitalTestBase} from "./utils/OrbitalTestBase.sol";

contract OrbitalV4HookAccrueHarness is OrbitalV4Hook {
    constructor(
        IPoolManager manager_,
        Currency[4] memory currencies_,
        uint8[4] memory decimals_,
        uint256[4] memory reserves_,
        SegmentedTorus4.Tick[] memory ticks_,
        uint24 fee_,
        int24 spacing_,
        address owner_
    ) OrbitalV4Hook(manager_, currencies_, decimals_, reserves_, ticks_, fee_, spacing_, owner_) {}

    function accrueFee(uint8 asset, uint256 fee, uint256 interiorMask) external {
        _accrueFee(asset, fee, interiorMask);
    }
}

/// @notice A swap that starts with no range in range must not revert on fee accrual.
/// @dev The engine refuses to trade from an all-boundary book today, so this path is
///      defensive: the hook must not depend on that to keep swaps from reverting here.
contract OrbitalV4HookFeeAccrualTest is OrbitalTestBase {
    function testFeeWithNoInteriorRangeStaysInCustodyAsDust() public {
        _deployManager();
        _deployTokens([uint8(6), 6, 18, 18]);
        uint256[4] memory reserves = OrbitalDemoConfig.reserves();
        SegmentedTorus4.Tick[] memory ticks = OrbitalDemoConfig.ticks();
        bytes memory initCode = abi.encodePacked(
            type(OrbitalV4HookAccrueHarness).creationCode,
            abi.encode(manager, currencies, decimals, reserves, ticks, poolFee, TICK_SPACING, address(this))
        );
        bytes32 salt = HookAddressMiner.find(address(this), keccak256(initCode), FLAGS, 200_000);
        OrbitalV4HookAccrueHarness harness = new OrbitalV4HookAccrueHarness{salt: salt}(
            manager, currencies, decimals, reserves, ticks, poolFee, TICK_SPACING, address(this)
        );

        harness.accrueFee(0, 500, 0);
        uint256[4] memory liability = harness.feeLiability();
        assertEq(liability[0], 0, "an unallocated fee is not owed to any LP");
    }
}
