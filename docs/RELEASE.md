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
| Shared-book routing | Solidity tests exercise canonical pair directions and a stateful all-pair sequence against one reserve book. |
| Geometry and crossings | Solidity and independent Python tests cover fixed-partition quotes, tick crossing, recovery, invalid states, and precision bounds. |
| LP accounting | Range-share and fee-book tests cover proportional claims, independent range inventory, dust, and unauthorized-withdrawal boundaries. |
| BigInt replay | The dependency-free simulator replays a versioned WAD fixture using exact integer transitions, including tick crossing and reverse recovery. |

The final regression command currently runs 44 Solidity tests, 31 independent Python-reference tests, and 8 simulator tests. [Gas measurements](results/gas-baseline.md) are bounded local hook-operation measurements, not end-to-end router or deployment costs.

## Deployment provenance

The hook deployment recipe is [`DeployOrbitalHook.s.sol`](../contracts/script/DeployOrbitalHook.s.sol). It mines the v4 permission-address salt from exact constructor calldata and reads `PRIVATE_KEY`, `POOL_MANAGER`, and mock-token addresses only from environment variables.

No deployment transaction, contract address, or testnet claim is included in this revision. A future deployment record must include the chain, transaction hash, deployed addresses, source commit, constructor inputs, and independently refreshed hook reads before it is marked live.

## Current limits

- Fixed demo basket: four mock assets and two configured ranges; this is not a universal stablecoin pool.
- Exact-input behavior only. Exact-output routing is rejected.
- The hook adapter is tested with a local manager fixture. It is not a production custody path or a deployed PoolManager integration.
- No verified public solver/router or position-manager calldata schema is included in this revision.
- The BigInt replayer is an explanatory fixture, not a production price or execution service.
- No audit, economic review, real-fund deployment, or depeg-exit safety claim is made.

## Attribution

- [Paradigm’s Orbital article](https://www.paradigm.xyz/writing/orbital) is the mathematical inspiration.
- [Oxkai/Orbital.Hook](https://github.com/Oxkai/Orbital.Hook) was consulted as an implementation reference.
- Uniswap v4-core is a pinned submodule dependency.

The project code is independently authored. Attribution does not imply equivalence to, endorsement by, or code reuse from the referenced projects.
