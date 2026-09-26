// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";

import {OrbitalDeployBase, OrbitalDeployment} from "./OrbitalDeployBase.sol";

/// @notice End-to-end demo deployment: mock basket, hook, six pools, seeded ranges, router.
/// @dev Env: PRIVATE_KEY (required); POOL_MANAGER (optional: zero or unset deploys a
///      fresh local PoolManager); DEPLOYMENT_OUT (optional JSON path under ./deployments).
///      Mock tokens have a public `mint`, so they double as a testnet faucet.
contract DeployOrbitalDemo is OrbitalDeployBase {
    uint256 internal constant DEMO_FLOAT = 1_000_000;

    function run() external returns (OrbitalDeployment memory deployment) {
        deployment = deploy(vm.envUint("PRIVATE_KEY"), vm.envOr("POOL_MANAGER", address(0)));
        string memory out = vm.envOr("DEPLOYMENT_OUT", string(""));
        if (bytes(out).length != 0) _writeDeployment(deployment, out);
    }

    /// @notice Parameterized entry point, also used by tests to avoid process-global env.
    function deploy(uint256 privateKey, address managerAddress) public returns (OrbitalDeployment memory deployment) {
        address deployer = vm.addr(privateKey);
        vm.startBroadcast(privateKey);
        deployment.manager = managerAddress == address(0)
            ? IPoolManager(deployCode("PoolManager.sol:PoolManager", abi.encode(deployer)))
            : IPoolManager(managerAddress);

        string[4] memory symbols = ["USDC", "USDT", "DAI", "FRAX"];
        uint8[4] memory tokenDecimals = [uint8(6), 6, 18, 18];
        address[4] memory tokens;
        for (uint256 i; i < 4; ++i) {
            tokens[i] = address(new MockERC20(string.concat("Orbital Mock ", symbols[i]), symbols[i], tokenDecimals[i]));
        }
        uint8[4] memory decimals;
        (deployment.currencies, decimals) = _canonical(tokens);

        deployment.hook = _deployHook(deployment.manager, deployment.currencies, decimals, deployer);
        deployment.router = new PoolSwapTest(deployment.manager);
        _initializePools(deployment.manager, deployment.hook, deployment.currencies);
        _fundAndSeed(deployment, decimals, deployer);
        vm.stopBroadcast();
    }

    function _fundAndSeed(OrbitalDeployment memory deployment, uint8[4] memory decimals, address deployer) private {
        uint256[4] memory seedAmounts = deployment.hook.seedAmounts();
        for (uint256 i; i < 4; ++i) {
            MockERC20 token = MockERC20(Currency.unwrap(deployment.currencies[i]));
            uint256 float = DEMO_FLOAT * 10 ** decimals[i];
            token.mint(deployer, seedAmounts[i] + float);
            // Exact allowances: the seed for the hook, the demo float for the router.
            token.approve(address(deployment.hook), seedAmounts[i]);
            token.approve(address(deployment.router), float);
        }
        deployment.hook.seed(deployer);
    }
}
