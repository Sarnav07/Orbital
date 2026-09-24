// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Currency} from "v4-core/types/Currency.sol";

import {OrbitalV4Hook} from "../src/OrbitalV4Hook.sol";
import {OrbitalDeployBase} from "./OrbitalDeployBase.sol";

/// @notice Deploys only the hook against an existing PoolManager and four existing tokens.
/// @dev Env: PRIVATE_KEY, POOL_MANAGER, USDC, USDT, DAI, FRAX (any address order).
///      Pools, seeding and the demo router are handled by DeployOrbitalDemo.
contract DeployOrbitalHook is OrbitalDeployBase {
    function run() external returns (OrbitalV4Hook hook) {
        address[4] memory tokens =
            [vm.envAddress("USDC"), vm.envAddress("USDT"), vm.envAddress("DAI"), vm.envAddress("FRAX")];
        return deploy(vm.envUint("PRIVATE_KEY"), IPoolManager(vm.envAddress("POOL_MANAGER")), tokens);
    }

    /// @notice Parameterized entry point, also used by tests to avoid process-global env.
    function deploy(uint256 privateKey, IPoolManager manager, address[4] memory tokens)
        public
        returns (OrbitalV4Hook hook)
    {
        (Currency[4] memory currencies, uint8[4] memory decimals) = _canonical(tokens);

        vm.startBroadcast(privateKey);
        hook = _deployHook(manager, currencies, decimals, vm.addr(privateKey));
        vm.stopBroadcast();
    }
}
