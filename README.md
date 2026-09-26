<p align="center">
  <img src="docs/assets/orbital-cover.svg" alt="Orbital — one reserve book for n stablecoins" width="720">
</p>

<p align="center">
  <a href="https://orbital-protocol-mu.vercel.app/app"><strong>Launch app</strong></a> ·
  <a href="https://orbital-protocol-mu.vercel.app/docs">Documentation</a> ·
  <a href="#deployed-contracts">Contract addresses</a>
</p>

**Orbital** is an experimental **Uniswap v4 hook** that trades **n stablecoins through one shared, concentrated reserve book**, using Paradigm's n-dimensional Orbital sphere-and-torus geometry. The deployed instance is a **4-coin book (USDC, USDT, DAI, FRAX) live on four testnets**: Unichain Sepolia (featured), Ethereum Sepolia, Arbitrum Sepolia and Arc Testnet.

- **Swap stablecoins** through any pair in the basket: every pair is a v4 pool, six in the 4-coin deployment. Quotes are exact, slippage is bounded and each transaction is wallet-reviewed.
- **Provide liquidity to a range.** Pick how tightly to concentrate around the peg; each range tracks its own inventory and fees.
- **Watch the book live.** Reserves, range states, solvency and recent swaps are read straight from the hook, no wallet required.
- **Stress-test a depeg.** A sandbox model shows which ranges trap, and when, as one coin floods the book.

n(n − 1)/2 pools, one book. A pair-per-pool design needs six pools for four coins and twenty-eight for eight, each funded separately. Orbital keeps one n-asset reserve vector behind all of them, so a USDC/DAI trade and a USDT/FRAX trade move the same state. The curve sets the price; it does not force a 1:1 exchange.

## Our Uniswap v4 hook

We implemented **four hook callbacks**. Together they replace v4's concentrated-liquidity leg with the Orbital curve and keep all custody in the PoolManager:

| Callback | Flag | What we implemented |
| --- | --- | --- |
| `beforeInitialize` | `1 << 13` | Admits only the canonical pair keys for the basket (six for the deployed 4-coin basket; fee 500, tick spacing 60, this hook). |
| `beforeAddLiquidity` | `1 << 11` | Always reverts: native v4 positions cannot attach. Liquidity goes through the hook's range functions. |
| `beforeSwap` | `1 << 7` | Normalizes decimals, charges the fee once on input, prices the trade across up to 8 range crossings, mints input claims and burns output claims. |
| `beforeSwapReturnDelta` | `1 << 3` | Returns `BeforeSwapDelta(+in, −out)`, so the hook's curve fully replaces the pool's swap. |

v4 reads a hook's permissions from the low 14 bits of its address, so every deployed hook address carries these flags as **`0x2888`** in those bits. `hookData = abi.encode(minAmountOut, deadline)` adds optional slippage and deadline guards. The geometry and the Python reference are general n; the Solidity hook fixes n = 4 so that √n = 2 is exact in WAD ([MATH-5](docs/MATH.md#1-per-tick-geometry-and-canonical-coordinates)).

[Hook implementation](contracts/src/OrbitalV4Hook.sol) · [Swap engine](contracts/src/math/SegmentedTorus4.sol) · [Mathematics](docs/MATH.md)

## Built on Unichain

**Unichain Sepolia** hosts the featured pool (Ethereum Sepolia, Arbitrum Sepolia and Arc Testnet run the same pool), and **Uniswap v4's PoolManager holds all custody** as ERC-6909 claims. Swaps settle inside one `unlock`: the router pays the input, the hook takes it as claims and burns the output claims, and anything unsettled reverts the whole transaction. Range deposits, withdrawals and fee collection use the same claim path through the hook's own `unlock` callback.

[Deployment script](contracts/script/DeployOrbitalDemo.s.sol) · [Network configuration](app/src/chain/config.ts)

## Deployed contracts

The same four-coin pool runs on **four testnets**, each with its own hook, router and mock basket, all seeded with about 3.59M of each coin. The app's **Pools** page lists them; pick a network in the app to swap or provide liquidity on it.

| Network | Chain ID | Gas | OrbitalV4Hook | PoolManager | Live swap | Manifest |
| --- | --- | --- | --- | --- | --- | --- |
| **Unichain Sepolia** | `1301` | ETH | [0x5fe2…A888](https://unichain-sepolia.blockscout.com/address/0x5fe242b3544Dd0d30C395843dE75A2B8d4dBA888) | [0x00B0…62AC](https://unichain-sepolia.blockscout.com/address/0x00B036B58a818B1BC34d502D3fE730Db729e62AC) | [0x59f6dfa9…](https://unichain-sepolia.blockscout.com/tx/0x59f6dfa946fe47b2e008c5b376af9d389113f1e298df6dcd568afea3b8d840b2) | [unichain-sepolia.json](contracts/deployments/unichain-sepolia.json) |
| **Ethereum Sepolia** | `11155111` | ETH | [0x1140…6888](https://sepolia.etherscan.io/address/0x1140236A2d35b328f38F9eF8Bee3C781F0fA6888) | [0xE03A…3543](https://sepolia.etherscan.io/address/0xE03A1074c86CFeDd5C142C4F04F1a1536e203543) | [0xc6cecb15…](https://sepolia.etherscan.io/tx/0xc6cecb151a8e4545b5062c6a3f928c62dc994e35a73ff34acae1fd79bbdd61ea) | [sepolia.json](contracts/deployments/sepolia.json) |
| **Arbitrum Sepolia** | `421614` | ETH | [0x39Fb…6888](https://sepolia.arbiscan.io/address/0x39Fb6DC7EF95c33FBDa2c8B2ED90f8E069736888) | [0xFB3e…a317](https://sepolia.arbiscan.io/address/0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317) | [0xb2fcf6df…](https://sepolia.arbiscan.io/tx/0xb2fcf6df2c5672065bfc55a73a0810414f4c08851c739ce665990f32207a94dc) | [arbitrum-sepolia.json](contracts/deployments/arbitrum-sepolia.json) |
| **Arc Testnet** | `5042002` | USDC | [0xb2e4…E888](https://explorer.testnet.arc.io/address/0xb2e429bC1E7184F717a1dfEEd34F72FCA130E888) | [0x8366…0951](https://explorer.testnet.arc.io/address/0x8366a39CC670B4001A1121B8F6A443A643e40951) | [0xdb6a6c55…](https://explorer.testnet.arc.io/tx/0xdb6a6c5571b9080a900eca371e95391d926c5a2158c7774a9bc3d64f8b55ed97) | [arc-testnet.json](contracts/deployments/arc-testnet.json) |

On 2026-09-26 every hook was **replaced by the audited build** ([AUDIT.md](docs/AUDIT.md)). Each network kept its mock tokens, router and PoolManager, so token addresses did not change. The previous hooks remain on-chain, unused by the app, and are recorded under `supersedes` in each manifest. Each new pool was seeded with the same 3.59M of each coin and made the same live swap through its router with `minAmountOut` and a deadline: 1,000 USDC in, exactly 999.433404420670936920 DAI out, 0.5 USDC fee. `seeded()` and `solvency()` were read back on every chain.

The PoolManagers on Unichain Sepolia, Ethereum Sepolia and Arbitrum Sepolia are Uniswap's canonical v4 deployments. On Arc, the PoolManager at `0x8366…0951` runs code byte-identical to them, compared with each contract's own address masked. Its owner differs from Uniswap's testnet owner, so it cannot be proven to be Uniswap's own deployment. That owner can only switch on protocol fees, which are off, and since the hook consumes every swap the core pool never trades. Every new hook and fee book is source-verified: on Blockscout for Unichain Sepolia, and as exact matches on [Sourcify](https://sourcify.dev) for Ethereum Sepolia, Arbitrum Sepolia and Arc Testnet.

### Unichain Sepolia (featured) · Chain ID `1301` · Gas: ETH

| Contract / token | Address |
| --- | --- |
| **OrbitalV4Hook** | [0x5fe242b3544Dd0d30C395843dE75A2B8d4dBA888](https://unichain-sepolia.blockscout.com/address/0x5fe242b3544Dd0d30C395843dE75A2B8d4dBA888) |
| **RangeFeeBook4** | [0xCB8822F09717e40F340183DDE97e544b4A2c7ae1](https://unichain-sepolia.blockscout.com/address/0xCB8822F09717e40F340183DDE97e544b4A2c7ae1) |
| **Swap router** (v4-core `PoolSwapTest`) | [0x9EA2eB21BcF6178f1982d94181f6bc88A614dA42](https://unichain-sepolia.blockscout.com/address/0x9EA2eB21BcF6178f1982d94181f6bc88A614dA42) |
| **PoolManager** (official Uniswap v4) | [0x00B036B58a818B1BC34d502D3fE730Db729e62AC](https://unichain-sepolia.blockscout.com/address/0x00B036B58a818B1BC34d502D3fE730Db729e62AC) |
| **USDT · 6 decimals** | [0x4eBEa178D6a3F18C166cb8C5b67BA73dBCD26b4A](https://unichain-sepolia.blockscout.com/address/0x4eBEa178D6a3F18C166cb8C5b67BA73dBCD26b4A) |
| **FRAX · 18 decimals** | [0x68400C108461BD3D6F2124D6B81127D5f2c1EF65](https://unichain-sepolia.blockscout.com/address/0x68400C108461BD3D6F2124D6B81127D5f2c1EF65) |
| **DAI · 18 decimals** | [0xD3c22D959fE356a4C0AA6B2e3A8B2C6cf04F2Aae](https://unichain-sepolia.blockscout.com/address/0xD3c22D959fE356a4C0AA6B2e3A8B2C6cf04F2Aae) |
| **USDC · 6 decimals** | [0xFc82C77256e74289f1B70f14126d21550C495a33](https://unichain-sepolia.blockscout.com/address/0xFc82C77256e74289f1B70f14126d21550C495a33) |

<details>
<summary>Deployment evidence — transactions, constructor inputs and verification</summary>

| Evidence | Transaction |
| --- | --- |
| Hook deployment (CREATE2 factory, 5,514,456 gas) | [0xa65fc58f…64bc9](https://unichain-sepolia.blockscout.com/tx/0xa65fc58ffbd5ceef62f67c98caedc687c56fe7c7df394e396515070f62a64bc9) |
| Range seeding (3.59M of each asset as PoolManager claims) | [0xdfb39755…1ffa0](https://unichain-sepolia.blockscout.com/tx/0xdfb3975585b086827ebf8cd4c7383b62cc5c0b0a35dec4eea92dcf911fb1ffa0) |
| Live swap: 1,000 USDC → 999.4334 DAI, 0.5 USDC fee, `minAmountOut` + deadline (1,235,447 gas) | [0x59f6dfa9…840b2](https://unichain-sepolia.blockscout.com/tx/0x59f6dfa946fe47b2e008c5b376af9d389113f1e298df6dcd568afea3b8d840b2) |

- **Deployment:** redeployed on 2026-09-26 with `script/RedeployOrbitalHook.s.sol` from the audited source ([AUDIT.md](docs/AUDIT.md)), starting at block 63,593,860 (16 transactions). It reuses the tokens, router and PoolManager listed here. The previous hook `0x10f1…2888` (source commit `ff686ea`) is superseded.
- **Constructor inputs:** the sorted basket and decimals above; reserves of 15,000,000 WAD per asset; three 10M-WAD ranges at k/r 1.001 / 1.004 / 1.05; fee 500; tick spacing 60; owner `0x54560095593B57Ad71572336037435Ff1E50E4EA`.
- **Verification:** the hook and fee book are source-verified on Blockscout; the router and tokens are exact matches on [Sourcify](https://sourcify.dev).
- **Read back after the swap:** `seeded()` is true and `solvency()` shows held claims equal to the requirement for every asset.

</details>

The four tokens are **mock assets with a public `mint`**. They are not issuer-backed, not LP receipts and have no value. The PoolManager is Uniswap's canonical Unichain Sepolia deployment.

[Deployment manifests](contracts/deployments) · [Release notes](docs/RELEASE.md)

## Development

Requires **Foundry 1.7.1**, **Python 3.14.6**, **Node.js 22+**, **Make**, and **jq** (for `app-e2e`).

```bash
git clone --recurse-submodules https://github.com/Sarnav07/Orbital.git
cd Orbital
make check
cd app && npm run dev
```

Open **http://localhost:5173/app**. The app is built in Uniswap's interface style under the Orbital brand. **Swap**, **Pools** and **Explore** read and trade the live deployments (pick the network in the nav). **Sandbox** runs the same BigInt engine locally.

```bash
make app-e2e                                    # deploy to a throwaway anvil node, drive it with the app's builders
cd contracts && FOUNDRY_PROFILE=ci forge test   # deeper fuzz and invariant campaigns
```

To deploy a fresh demo, copy `.env.example` to `.env`, add a funded testnet key, export it (`set -a && . ./.env && set +a`), and from `contracts/` run `forge build && forge script script/DeployOrbitalDemo.s.sol --rpc-url $RPC_URL --broadcast`. With `POOL_MANAGER=0x0…0` on anvil, the script deploys its own PoolManager. To replace only the hook on a network that already runs the demo, set `POOL_MANAGER`, `ROUTER` and the four token addresses and run `script/RedeployOrbitalHook.s.sol` the same way.

[Testing](docs/TESTS.md) · [Mathematics](docs/MATH.md) · [Paper implementation](docs/PAPER_IMPLEMENTATION.md) · [Protocol guide](https://orbital-protocol-mu.vercel.app/docs)

The repository contains the Solidity hook and math libraries, an independent Python Decimal reference, a dependency-free BigInt engine shared by tests and the app, and the Vite/React app.

## Status and credits

**Status:** experimental testnet software on mock tokens. Not professionally audited; an internal security review and its fixes are in [AUDIT.md](docs/AUDIT.md). The limits are stated in [PAPER_IMPLEMENTATION.md](docs/PAPER_IMPLEMENTATION.md#open-obligations), and static analysis is triaged in [results/static-analysis.md](docs/results/static-analysis.md).

**Credits:**
- Adapted from the [Orbital research](https://www.paradigm.xyz/writing/orbital) by Dan Robinson, Ciamac Moallemi and Dave White.
- Built on [Uniswap v4-core](https://github.com/Uniswap/v4-core).
- [Oxkai/Orbital.Hook](https://github.com/Oxkai/Orbital.Hook) was consulted as a reference.

**License:** the project code is independently authored under the [MIT License](LICENSE). Attribution implies no code reuse from, or endorsement by, these projects.
