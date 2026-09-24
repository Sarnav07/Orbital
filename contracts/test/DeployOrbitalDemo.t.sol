// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {SwapParams} from "v4-core/types/PoolOperation.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";

import {DeployOrbitalDemo} from "../script/DeployOrbitalDemo.s.sol";
import {DeployOrbitalHook} from "../script/DeployOrbitalHook.s.sol";
import {OrbitalDeployment, OrbitalDemoConfig} from "../script/OrbitalDeployBase.sol";
import {OrbitalV4Hook} from "../src/OrbitalV4Hook.sol";

/// @notice Executes the deployment scripts exactly as `forge script` would, on a local manager.
contract DeployOrbitalDemoTest is Test {
    using StateLibrary for IPoolManager;

    uint256 private constant DEPLOYER_KEY = 0xA11CE;

    function testDemoScriptDeploysSeedsAndServesAllSixPools() public {
        OrbitalDeployment memory deployment = new DeployOrbitalDemo().deploy(DEPLOYER_KEY, address(0));
        OrbitalV4Hook hook = deployment.hook;

        assertEq(uint160(address(hook)) & Hooks.ALL_HOOK_MASK, OrbitalDemoConfig.FLAGS);
        assertTrue(hook.seeded());
        assertEq(hook.owner(), vm.addr(DEPLOYER_KEY));
        for (uint8 i = 1; i < 4; ++i) {
            assertTrue(Currency.unwrap(hook.currencyAt(i - 1)) < Currency.unwrap(hook.currencyAt(i)));
        }
        (uint256[4] memory custody, uint256[4] memory required) = hook.solvency();
        for (uint256 i; i < 4; ++i) {
            assertGe(custody[i], required[i]);
            assertGt(required[i], 0);
        }

        IPoolManager manager = deployment.manager;
        for (uint8 a; a < 4; ++a) {
            for (uint8 b = a + 1; b < 4; ++b) {
                PoolKey memory key = _key(hook, a, b);
                (uint160 sqrtPriceX96,,,) = manager.getSlot0(key.toId());
                assertGt(sqrtPriceX96, 0);
            }
        }

        // The deployed demo router settles a real swap for any funded account.
        address trader = makeAddr("trader");
        MockERC20 input = MockERC20(Currency.unwrap(hook.currencyAt(0)));
        MockERC20 output = MockERC20(Currency.unwrap(hook.currencyAt(3)));
        uint256 amountIn = 100 * 10 ** input.decimals();
        input.mint(trader, amountIn);
        // Small test amount, exactly representable as int256.
        // forge-lint: disable-next-line(unsafe-typecast)
        int256 exactIn = -int256(amountIn);
        vm.startPrank(trader);
        input.approve(address(deployment.router), amountIn);
        deployment.router
            .swap(
                _key(hook, 0, 3),
                SwapParams({
                    zeroForOne: true, amountSpecified: exactIn, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
                }),
                PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
                ""
            );
        vm.stopPrank();
        assertGt(output.balanceOf(trader), 99 * 10 ** output.decimals());
    }

    function testHookScriptSortsExistingTokensAndDeploysAtMinedAddress() public {
        address deployer = vm.addr(DEPLOYER_KEY);
        IPoolManager manager = IPoolManager(deployCode("PoolManager.sol:PoolManager", abi.encode(deployer)));
        // Deliberately supply symbols whose addresses are not in canonical order.
        string[4] memory symbols = ["USDC", "USDT", "DAI", "FRAX"];
        uint8[4] memory decimals = [uint8(6), 6, 18, 18];
        address[4] memory tokens;
        for (uint256 i; i < 4; ++i) {
            tokens[i] = address(new MockERC20(symbols[i], symbols[i], decimals[i]));
        }

        OrbitalV4Hook hook = new DeployOrbitalHook().deploy(DEPLOYER_KEY, manager, tokens);

        assertEq(uint160(address(hook)) & Hooks.ALL_HOOK_MASK, OrbitalDemoConfig.FLAGS);
        assertEq(address(hook.poolManager()), address(manager));
        for (uint8 i; i < 4; ++i) {
            MockERC20 token = MockERC20(Currency.unwrap(hook.currencyAt(i)));
            assertEq(hook.decimalsAt(i), token.decimals());
            if (i > 0) assertTrue(Currency.unwrap(hook.currencyAt(i - 1)) < address(token));
        }
    }

    function _key(OrbitalV4Hook hook, uint8 a, uint8 b) private view returns (PoolKey memory) {
        return PoolKey({
            currency0: hook.currencyAt(a),
            currency1: hook.currencyAt(b),
            fee: OrbitalDemoConfig.FEE,
            tickSpacing: OrbitalDemoConfig.TICK_SPACING,
            hooks: IHooks(address(hook))
        });
    }
}
