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
| BigInt replay | The simulator recomputes every recorded transition and rejects any amount or bitmap it cannot reproduce. Solidity and JavaScript assert the same vector file exactly. |

The regression command currently runs 65 Solidity tests (including 2 invariant campaigns), 31 independent Python-reference tests, 11 simulator tests and 19 app tests, plus the app typecheck and production build. [Gas measurements](results/gas-baseline.md) are full swaps through a real PoolManager and router.

## Deployment provenance

The end-to-end recipe is [`DeployOrbitalDemo.s.sol`](../contracts/script/DeployOrbitalDemo.s.sol); [`DeployOrbitalHook.s.sol`](../contracts/script/DeployOrbitalHook.s.sol) deploys only the hook against existing tokens. Both mine the v4 permission-address salt against the CREATE2 factory that performs the deployment, sort tokens canonically and read their decimals. Secrets come only from environment variables.

No deployment transaction, contract address, or testnet claim is included in this revision. A future deployment record must include the chain, transaction hash, deployed addresses, source commit, constructor inputs, and independently refreshed hook reads before it is marked live.

## Current limits

- Fixed demo basket: four mock assets and three configured ranges; this is not a universal stablecoin pool.
- Exact-input behavior only. Exact-output routing is rejected.
- A swap that would trap every range (all-boundary continuation) reverts in full.
- The demo router is v4-core's `PoolSwapTest`; no production router, position manager or wallet UI is included.
- Fees go to ranges interior at swap start, weighted by radius; there is no fee governance or pause authority.
- The BigInt replayer is an explanatory fixture, not a production price or execution service.
- No audit, economic review, real-fund deployment, or depeg-exit safety claim is made.

## Attribution

- [Paradigm’s Orbital article](https://www.paradigm.xyz/writing/orbital) is the mathematical inspiration.
- [Oxkai/Orbital.Hook](https://github.com/Oxkai/Orbital.Hook) was consulted as an implementation reference.
- Uniswap v4-core is a pinned submodule dependency.

The project code is independently authored. Attribution does not imply equivalence to, endorsement by, or code reuse from the referenced projects.
