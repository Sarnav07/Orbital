# Orbital release package

## What this prototype demonstrates

**One reserve book for n stablecoins.** Orbital's design puts any number of stablecoins behind one shared reserve book: n coins, n(n − 1)/2 pair pools, one state. The pricing uses Orbital's n-dimensional sphere/torus geometry rather than an independent constant-product reserve for every pair. This revision deploys the n = 4 case: USDC, USDT, DAI and FRAX exposed through six canonical v4 pools, with the hook advancing one shared four-asset reserve state.

The repository demonstrates the mechanics, not a production-ready stablecoin exchange. It is experimental, unaudited, and for mock/test environments only.

## Reproducible build

This document belongs to the source revision being reviewed. Anchor any reproduction to its immutable Git commit, then run:

```sh
git rev-parse HEAD
make check
```

Required local tooling is Foundry `v1.7.1`, Python `3.14.6`, Node.js 22+, Git, Make, and jq (for `make app-e2e`). Clone recursively so the pinned `v4-core` submodule is present. The [root README](../README.md) contains the full setup.

## Evidence included in this revision

| Surface | Evidence |
| --- | --- |
| Real v4 settlement | Integration tests drive a real PoolManager and `PoolSwapTest`: 6↔18-decimal swaps, all six pairs on one book, crossings and recovery, fees, slippage/deadline guards, native-liquidity and foreign-pool rejection. |
| Shared-book routing | Every route moves only its two coordinates of one reserve vector; a zero-fee, 18-decimal hook reproduces the engine vectors to the wei through the manager. |
| Deployment | `DeployOrbitalDemo`, `DeployOrbitalHook` and `RedeployOrbitalHook` are executed in tests; `make app-e2e` broadcasts the demo to a fresh anvil node on every CI run. |
| Security review | [AUDIT.md](AUDIT.md): line-by-line review, proof-of-concept tests for each finding, fixes, and a redeploy of the audited hook on all four networks. |
| Solvency | A fuzzed invariant over random swaps, deposits, withdrawals and fee collection keeps claims custody ≥ required inventory and the book on the aggregate torus. |
| Geometry and crossings | Solidity and independent Python tests cover fixed-partition quotes, tick crossing, recovery, invalid states, and precision bounds. |
| LP accounting | Range-share and fee-book tests cover proportional claims, independent range inventory, dust, and unauthorized-withdrawal boundaries. |
| Live app | The `/app` Swap page (Uniswap-style interface) quotes with an exact mirror of `beforeSwap`, which reproduces the recorded testnet swap to the wei. `make app-e2e` proves its transaction builders against real contracts. |
| BigInt replay | The simulator recomputes every recorded transition and rejects any amount or bitmap it cannot reproduce. Solidity and JavaScript assert the same vector file exactly. |

The regression command currently runs:
- 74 Solidity tests, including 2 invariant campaigns, boundary-status regressions and differential checks against v4 `FullMath`
- 32 independent Python-reference tests
- 13 simulator tests
- 102 app unit/render tests
- the app typecheck and production build

`make app-e2e` adds 4 real-contract tests against a local anvil deployment, driven by the app's transaction builders. Static-analysis triage is in [results/static-analysis.md](results/static-analysis.md). [Gas measurements](results/gas-baseline.md) are full swaps through a real PoolManager and router.

## Deployment provenance

The end-to-end recipe is [`DeployOrbitalDemo.s.sol`](../contracts/script/DeployOrbitalDemo.s.sol). [`DeployOrbitalHook.s.sol`](../contracts/script/DeployOrbitalHook.s.sol) deploys only the hook against existing tokens, and [`RedeployOrbitalHook.s.sol`](../contracts/script/RedeployOrbitalHook.s.sol) replaces the hook on a network that already runs the demo: new hook, six new pools and seeding, with the network's existing tokens, router and PoolManager. All of them mine the v4 permission-address salt against the CREATE2 factory that performs the deployment, sort tokens canonically, read their decimals and approve exact amounts. Secrets come only from environment variables.

**Current deployments: the audited hook, 2026-09-26** ([AUDIT.md](AUDIT.md)), deployed with `RedeployOrbitalHook.s.sol`. Each deployment is 16 transactions, all successful. The hook's CREATE2 deployment used about 5.51M gas.

| Network | Hook | Fee book | First block | Live swap (1,000 USDC → 999.433404420670936920 DAI) |
| --- | --- | --- | --- | --- |
| Unichain Sepolia (1301) | `0x5fe242b3544Dd0d30C395843dE75A2B8d4dBA888` | `0xCB8822F09717e40F340183DDE97e544b4A2c7ae1` | 63,593,860 | `0x59f6dfa946fe47b2e008c5b376af9d389113f1e298df6dcd568afea3b8d840b2` (1,235,447 gas) |
| Ethereum Sepolia (11155111) | `0x1140236A2d35b328f38F9eF8Bee3C781F0fA6888` | `0x8eAb08f48922821719e2872b33bba7e7516AbD98` | 11,787,893 | `0xc6cecb151a8e4545b5062c6a3f928c62dc994e35a73ff34acae1fd79bbdd61ea` (1,228,848 gas) |
| Arbitrum Sepolia (421614) | `0x39Fb6DC7EF95c33FBDa2c8B2ED90f8E069736888` | `0xB49a25e8773B9F6af8e4efd6b7791C823FA3fed5` | 313,004,707 | `0xb2fcf6df2c5672065bfc55a73a0810414f4c08851c739ce665990f32207a94dc` (1,234,444 gas) |
| Arc Testnet (5042002) | `0xb2e429bC1E7184F717a1dfEEd34F72FCA130E888` | `0xfBD7dad8D3a7Ce1758c93B73D7e053e36B1a3C0f` | 64,141,282 | `0xdb6a6c5571b9080a900eca371e95391d926c5a2158c7774a9bc3d64f8b55ed97` (1,233,088 gas) |

- **Same everywhere:** every swap passed `minAmountOut` and a deadline in hook data, and paid a 0.5 USDC fee. Afterwards `seeded()` is true and `solvency()` shows held claims equal to the requirement for each asset.
- **Verification:** every hook and fee book is source-verified: Unichain Sepolia on Blockscout; Ethereum Sepolia, Arbitrum Sepolia and Arc Testnet as exact matches (creation and runtime) on Sourcify.
- **Unchanged per network:** the mock tokens, the demo router and the PoolManager, so wallet token imports stay valid:
  - Unichain router `0x9EA2eB21BcF6178f1982d94181f6bc88A614dA42` and official PoolManager `0x00B036B58a818B1BC34d502D3fE730Db729e62AC`;
  - the other networks are in [`contracts/deployments/`](../contracts/deployments).
- **Arc's PoolManager** `0x8366a39CC670B4001A1121B8F6A443A643e40951` has runtime bytecode identical to Uniswap's v4 PoolManager on the other three chains, compared with each contract's own address masked. Its owner (`0x9701…3A52`) differs from Uniswap's testnet owner (`0x5b73…0519`), so it cannot be proven to be Uniswap's own deployment.

**Superseded deployments.** The pre-audit hooks stay on-chain but are no longer used by the app. Each manifest records its predecessor under `supersedes`.

- **Unichain Sepolia:** `0x10f107C223E83C0c3D43f3afe0eD75e0a06B2888`, 2026-09-24, source commit `ff686ea`; it was source-verified on Blockscout.
- **Ethereum Sepolia:** `0xd5892e1AF28A190D223f8b81844A7b7f680eA888`, 2026-09-25/26, broadcast from commit `1a99b99`, same contract source as `ff686ea`.
- **Arbitrum Sepolia:** `0x7E7a96FDB751392d45D2462E0B0B88aCCFefA888`, same date and source.
- **Arc:** `0x9cd75cfac54D6969a67009260A49d92c4f016888`, same date and source.
- **Arbitrum gas:** it was bridged from Ethereum Sepolia through the Arbitrum Inbox (`depositEth`, 0.05 ETH, tx `0x604908168e3de884f3e623d09d671e5187eeb782a453da9d445210a8295650e2`).

Addresses, symbols, decimals, deploy blocks, live swaps and superseded hooks are in [`contracts/deployments/`](../contracts/deployments). The full Unichain transaction table is in the [README](../README.md#deployed-contracts).

## Current limits

- Fixed demo basket: four mock assets and three configured ranges; this is not a universal stablecoin pool.
- Exact-input behavior only. Exact-output routing is rejected.
- A swap that would trap every range (all-boundary continuation) reverts in full.
- The demo router is v4-core's `PoolSwapTest`; no production router or position manager is included. The app supports injected browser wallets only (no WalletConnect/mobile).
- Fees go to ranges interior at swap start, weighted by radius; there is no fee governance or pause authority.
- The BigInt replayer is an explanatory fixture, not a production price or execution service.
- No professional audit, economic review, real-fund deployment, or depeg-exit safety claim is made. The internal review is in [AUDIT.md](AUDIT.md).

## Attribution

- [Paradigm’s Orbital article](https://www.paradigm.xyz/writing/orbital) is the mathematical inspiration.
- [Oxkai/Orbital.Hook](https://github.com/Oxkai/Orbital.Hook) was consulted as an implementation reference.
- Uniswap v4-core is a pinned submodule dependency.

The project code is independently authored. Attribution does not imply equivalence to, endorsement by, or code reuse from the referenced projects.
