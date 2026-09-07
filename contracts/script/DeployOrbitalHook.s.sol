// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {OrbitalV4Hook} from "../src/OrbitalV4Hook.sol";
import {SegmentedTorus4} from "../src/math/SegmentedTorus4.sol";
import {HookAddressMiner} from "../src/deploy/HookAddressMiner.sol";

/// @notice Reproducible deployment recipe for the four-mock-asset demo hook.
/// @dev Requires environment-only PRIVATE_KEY, POOL_MANAGER, USDC, USDT, DAI and FRAX.
contract DeployOrbitalHook is Script {
    uint256 internal constant WAD = 1e18;
    event HookDeployed(address indexed hook, bytes32 indexed salt, address indexed poolManager);

    function run() external returns (OrbitalV4Hook hook, bytes32 salt) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(privateKey);
        Currency[4] memory currencies = [
            Currency.wrap(vm.envAddress("USDC")),
            Currency.wrap(vm.envAddress("USDT")),
            Currency.wrap(vm.envAddress("DAI")),
            Currency.wrap(vm.envAddress("FRAX"))
        ];
        _requireSorted(currencies);
        uint256[4] memory reserves = [uint256(100 * WAD), 100 * WAD, 100 * WAD, 100 * WAD];
        SegmentedTorus4.Tick[] memory ticks = new SegmentedTorus4.Tick[](2);
        ticks[0] = SegmentedTorus4.Tick(100 * WAD, 110 * WAD, true);
        ticks[1] = SegmentedTorus4.Tick(100 * WAD, 130 * WAD, true);
        IPoolManager manager = IPoolManager(vm.envAddress("POOL_MANAGER"));
        bytes memory initCode = abi.encodePacked(
            type(OrbitalV4Hook).creationCode, abi.encode(manager, currencies, reserves, ticks, uint24(500), int24(60))
        );
        salt = HookAddressMiner.find(deployer, keccak256(initCode), 136, 100_000);
        vm.startBroadcast(privateKey);
        hook = new OrbitalV4Hook{salt: salt}(manager, currencies, reserves, ticks, 500, 60);
        vm.stopBroadcast();
        emit HookDeployed(address(hook), salt, address(manager));
    }

    function _requireSorted(Currency[4] memory currencies) private pure {
        for (uint256 i = 1; i < 4; ++i) {
            require(Currency.unwrap(currencies[i - 1]) < Currency.unwrap(currencies[i]), "unsorted currencies");
        }
    }
}
