// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";

import {OrbitalV4Hook} from "../src/OrbitalV4Hook.sol";
import {IMockToken, OrbitalDeployBase, OrbitalDeployment} from "./OrbitalDeployBase.sol";

/// @notice Replaces the Orbital hook on a network that already runs the demo: deploys a new hook
///         against the existing mock tokens and PoolManager, initializes its six pools, funds and
///         seeds its ranges, and records the existing router. Token addresses do not change.
/// @dev Env: PRIVATE_KEY, POOL_MANAGER, ROUTER, USDC, USDT, DAI, FRAX (any order);
///      DEPLOYMENT_OUT (optional JSON path under ./deployments). The previous hook stays on-chain.
contract RedeployOrbitalHook is OrbitalDeployBase {
    function run() external returns (OrbitalV4Hook hook) {
        address[4] memory tokens =
            [vm.envAddress("USDC"), vm.envAddress("USDT"), vm.envAddress("DAI"), vm.envAddress("FRAX")];
        IPoolManager manager = IPoolManager(vm.envAddress("POOL_MANAGER"));
        hook = deploy(vm.envUint("PRIVATE_KEY"), manager, tokens);
        string memory out = vm.envOr("DEPLOYMENT_OUT", string(""));
        if (bytes(out).length != 0) {
            OrbitalDeployment memory deployment;
            deployment.manager = manager;
            deployment.hook = hook;
            deployment.router = PoolSwapTest(vm.envAddress("ROUTER"));
            for (uint8 i; i < 4; ++i) {
                deployment.currencies[i] = hook.currencyAt(i);
            }
            _writeDeployment(deployment, out);
        }
    }

    /// @notice Parameterized entry point, also used by tests to avoid process-global env.
    function deploy(uint256 privateKey, IPoolManager manager, address[4] memory tokens)
        public
        returns (OrbitalV4Hook hook)
    {
        (Currency[4] memory currencies, uint8[4] memory decimals) = _canonical(tokens);
        address deployer = vm.addr(privateKey);

        vm.startBroadcast(privateKey);
        hook = _deployHook(manager, currencies, decimals, deployer);
        _initializePools(manager, hook, currencies);
        uint256[4] memory seedAmounts = hook.seedAmounts();
        for (uint256 i; i < 4; ++i) {
            IMockToken token = IMockToken(Currency.unwrap(currencies[i]));
            token.mint(deployer, seedAmounts[i]);
            token.approve(address(hook), seedAmounts[i]);
        }
        hook.seed(deployer);
        vm.stopBroadcast();
    }
}
