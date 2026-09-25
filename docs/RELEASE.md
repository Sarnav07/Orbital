# Orbital release package

## What this prototype demonstrates

**One reserve book for four stablecoins.** Orbital exposes USDC, USDT, DAI and FRAX through six canonical pair routes while the hook advances one shared four-asset reserve state. The pricing prototype uses bounded Orbital sphere/torus geometry rather than an independent constant-product reserve for every pair.

The repository demonstrates the mechanics, not a production-ready stablecoin exchange. It is experimental, unaudited, and for mock/test environments only.

## Reproducible build

This document belongs to the source revision being reviewed. Anchor any reproduction to its immutable Git commit, then run:

```sh
git rev-parse HEAD
make check
```

Required local tooling is Foundry `v1.7.1`, Python `3.14.6`, Node.js, Git, and Make. Clone recursively so the pinned `v4-core` submodule is present. The [root README](../README.md) contains the full setup.

## Evidence included in this revision

| Surface | Evidence |
| --- | --- |
| Real v4 settlement | Integration tests drive a real PoolManager and `PoolSwapTest`: 6↔18-decimal swaps, all six pairs on one book, crossings and recovery, fees, slippage/deadline guards, native-liquidity and foreign-pool rejection. |
| Shared-book routing | Every route moves only its two coordinates of one reserve vector; a zero-fee, 18-decimal hook reproduces the engine vectors to the wei through the manager. |
| Deployment | `DeployOrbitalDemo` and `DeployOrbitalHook` are executed in tests and were broadcast to a local anvil node, followed by a `cast` swap. |
| Solvency | A fuzzed invariant over random swaps, deposits, withdrawals and fee collection keeps claims custody ≥ required inventory and the book on the aggregate torus. |
| Geometry and crossings | Solidity and independent Python tests cover fixed-partition quotes, tick crossing, recovery, invalid states, and precision bounds. |
| LP accounting | Range-share and fee-book tests cover proportional claims, independent range inventory, dust, and unauthorized-withdrawal boundaries. |
| Live app | The `/app` Testnet tab quotes with an exact mirror of `beforeSwap`, which reproduces the recorded testnet swap to the wei. `make app-e2e` proves its transaction builders against real contracts. |
| BigInt replay | The simulator recomputes every recorded transition and rejects any amount or bitmap it cannot reproduce. Solidity and JavaScript assert the same vector file exactly. |

The regression command currently runs:
- 67 Solidity tests, including 2 invariant campaigns and a differential check against v4 `FullMath`
- 31 independent Python-reference tests
- 12 simulator tests
- 50 app unit/render tests
- the app typecheck and production build

`make app-e2e` adds 4 real-contract tests against a local anvil deployment, driven by the app's transaction builders. Static-analysis triage is in [results/static-analysis.md](results/static-analysis.md). [Gas measurements](results/gas-baseline.md) are full swaps through a real PoolManager and router.

## Deployment provenance

The end-to-end recipe is [`DeployOrbitalDemo.s.sol`](../contracts/script/DeployOrbitalDemo.s.sol); [`DeployOrbitalHook.s.sol`](../contracts/script/DeployOrbitalHook.s.sol) deploys only the hook against existing tokens. Both mine the v4 permission-address salt against the CREATE2 factory that performs the deployment, sort tokens canonically and read their decimals. Secrets come only from environment variables.

**Unichain Sepolia (chain 1301), 2026-09-24, source commit `ff686ea6d6794d9294862056951e294fb8bf975c`:**

- Hook `0x10f107C223E83C0c3D43f3afe0eD75e0a06B2888` and fee book: source verified on Blockscout. The router and the four mock tokens are exact matches on Sourcify.
- Fee book `0xcd548fB545745cBF0beE4454f3c996b649ac38Be`, demo router `0x9EA2eB21BcF6178f1982d94181f6bc88A614dA42`, official PoolManager `0x00B036B58a818B1BC34d502D3fE730Db729e62AC`.
- Hook deployment tx `0xee3e34e9d7e3934b1536a2067b9b0a8d3bcf52ee214be9f8322dda226bbeabe0`; seeding tx `0x07fd74b7193d74422cab2beaa5bcd42afdd7b0a344af56015deb33656b2e7220`.
- Live swap tx `0x23e33f62af47efb078152ae5d8ef18b144f65771b6bc2cf87c7414c353e19e46`: 1,000 USDC in, 999.4334 DAI out. The hook state was read back afterwards (`seeded`, `reserves`, `solvency`, `feeLiability`).

Addresses, symbols and decimals are in [`contracts/deployments/unichain-sepolia.json`](../contracts/deployments/unichain-sepolia.json); the full transaction table is in the [README](../README.md#deployment-unichain-sepolia-chain-1301).

## Current limits

- Fixed demo basket: four mock assets and three configured ranges; this is not a universal stablecoin pool.
- Exact-input behavior only. Exact-output routing is rejected.
- A swap that would trap every range (all-boundary continuation) reverts in full.
- The demo router is v4-core's `PoolSwapTest`; no production router or position manager is included. The app supports injected browser wallets only (no WalletConnect/mobile).
- Fees go to ranges interior at swap start, weighted by radius; there is no fee governance or pause authority.
- The BigInt replayer is an explanatory fixture, not a production price or execution service.
- No audit, economic review, real-fund deployment, or depeg-exit safety claim is made.

## Attribution

- [Paradigm’s Orbital article](https://www.paradigm.xyz/writing/orbital) is the mathematical inspiration.
- [Oxkai/Orbital.Hook](https://github.com/Oxkai/Orbital.Hook) was consulted as an implementation reference.
- Uniswap v4-core is a pinned submodule dependency.

The project code is independently authored. Attribution does not imply equivalence to, endorsement by, or code reuse from the referenced projects.
