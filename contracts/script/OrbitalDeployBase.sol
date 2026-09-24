// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";

import {OrbitalV4Hook} from "../src/OrbitalV4Hook.sol";
import {SegmentedTorus4} from "../src/math/SegmentedTorus4.sol";
import {HookAddressMiner} from "../src/deploy/HookAddressMiner.sol";

interface IERC20Decimals {
    function decimals() external view returns (uint8);
}

struct OrbitalDeployment {
    IPoolManager manager;
    OrbitalV4Hook hook;
    PoolSwapTest router;
    Currency[4] currencies;
}

/// @notice Demo basket parameters shared by the deployment scripts, tests and app.
/// @dev Three 10M-WAD ranges at k/r = 1.001, 1.004 and 1.05. The narrow ranges trap
///      around 0.90 and 0.80 single-coin depegs; the wide range keeps the book
///      tradable after they cross. Equal-price reserves are 15M WAD per asset while
///      the real inventory that must be funded is about 3.6M per asset.
library OrbitalDemoConfig {
    uint256 internal constant WAD = 1e18;
    uint24 internal constant FEE = 500;
    int24 internal constant TICK_SPACING = 60;
    uint256 internal constant RADIUS = 10_000_000 * WAD;
    uint160 internal constant FLAGS = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
        | Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG;
    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    uint256 internal constant MAX_MINING_ATTEMPTS = 500_000;

    function ticks() internal pure returns (SegmentedTorus4.Tick[] memory result) {
        result = new SegmentedTorus4.Tick[](3);
        result[0] = SegmentedTorus4.Tick({radius: RADIUS, k: RADIUS * 1001 / 1000, isInterior: true});
        result[1] = SegmentedTorus4.Tick({radius: RADIUS, k: RADIUS * 1004 / 1000, isInterior: true});
        result[2] = SegmentedTorus4.Tick({radius: RADIUS, k: RADIUS * 1050 / 1000, isInterior: true});
    }

    function reserves() internal pure returns (uint256[4] memory result) {
        uint256 equalPrice = RADIUS * 3 / 2;
        result = [equalPrice, equalPrice, equalPrice, equalPrice];
    }
}

abstract contract OrbitalDeployBase is Script {
    /// @dev Sorts token addresses into canonical v4 order and reads each token's decimals.
    function _canonical(address[4] memory tokens)
        internal
        view
        returns (Currency[4] memory currencies, uint8[4] memory decimals)
    {
        for (uint256 i = 1; i < 4; ++i) {
            for (uint256 j = i; j > 0 && tokens[j - 1] > tokens[j]; --j) {
                (tokens[j - 1], tokens[j]) = (tokens[j], tokens[j - 1]);
            }
        }
        for (uint256 i; i < 4; ++i) {
            if (i > 0) require(tokens[i - 1] != tokens[i], "duplicate token");
            currencies[i] = Currency.wrap(tokens[i]);
            decimals[i] = IERC20Decimals(tokens[i]).decimals();
        }
    }

    /// @dev Mines against the CREATE2 factory that actually performs the deployment,
    ///      then deploys through it so the mined and deployed addresses agree in
    ///      tests, local anvil runs and broadcasts alike.
    function _deployHook(IPoolManager manager, Currency[4] memory currencies, uint8[4] memory decimals, address owner)
        internal
        returns (OrbitalV4Hook hook)
    {
        bytes memory initCode = abi.encodePacked(
            type(OrbitalV4Hook).creationCode,
            abi.encode(
                manager,
                currencies,
                decimals,
                OrbitalDemoConfig.reserves(),
                OrbitalDemoConfig.ticks(),
                OrbitalDemoConfig.FEE,
                OrbitalDemoConfig.TICK_SPACING,
                owner
            )
        );
        bytes32 initCodeHash = keccak256(initCode);
        bytes32 salt = HookAddressMiner.find(
            CREATE2_FACTORY, initCodeHash, OrbitalDemoConfig.FLAGS, OrbitalDemoConfig.MAX_MINING_ATTEMPTS
        );
        address expected = HookAddressMiner.compute(CREATE2_FACTORY, salt, initCodeHash);
        (bool success,) = CREATE2_FACTORY.call(abi.encodePacked(salt, initCode));
        require(success && expected.code.length > 0, "hook deployment failed");
        hook = OrbitalV4Hook(expected);
    }
}
