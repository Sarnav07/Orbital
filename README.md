# Orbital

> **One reserve book for four stablecoins.**

Orbital is an experimental Uniswap v4 hook that applies bounded Orbital sphere and torus geometry to a shared stablecoin reserve book. In this prototype, USDC, USDT, DAI, and FRAX are represented by mock assets; their six canonical pair routes all advance the same four-asset state rather than splitting liquidity across six independent pools.

The project explores what concentrated multi-asset liquidity can look like when a pairwise swap is priced against one basket. It is not a production exchange, a deployed protocol, or a guarantee of stablecoin safety.

> [!WARNING]
> **Prototype only.** This repository is experimental, unaudited, and intended for mock/test environments. Swaps and range liquidity settle through the real Uniswap v4 PoolManager, including the [Unichain Sepolia deployment](#deployment-unichain-sepolia-chain-1301) of mock tokens recorded below. Do not use it with real funds.

## The idea

Four stablecoins create six pair routes. In a conventional pair-per-pool design, each route can fragment capital from the others. Orbital instead exposes those routes through one logical reserve book: a USDC/DAI trade and a USDT/FRAX trade both affect the same aggregate state.

The implementation fixes the demo to four assets and uses bounded geometry. It supports exact-input routes, up to eight tick transitions per swap, per-range liquidity with fee checkpoints, and a Uniswap v4 hook that custodies the basket as PoolManager claims and settles every swap itself. It does **not** implement a general N-asset pool, a production router or position manager, all-boundary continuation, or an audited release.

```mermaid
flowchart LR
    T[Trader or LP] --> P[Canonical v4 pair route]
    P --> H[OrbitalV4Hook]
    H --> S[Shared four-asset reserve book]
    S --> G[Sphere4 / SegmentedTorus4]
    G --> D[Custom BeforeSwapDelta]
    H --> C[PoolManager ERC-6909 claims: mint input, burn output]
    D --> M[v4 PoolManager settles the router]
    C --> M
    M --> T
```

## Mathematical model

Orbital is informed by Paradigm's Orbital research. The reference geometry permits an asset count `n >= 2`; the Solidity prototype deliberately fixes `n = 4`, where `sqrt(n) = 2` exactly in WAD arithmetic.

### Sphere branch

For normalized reserves `xᵢ` and a positive radius `r`, the nonnegative-price sphere branch is:

```text
Σ (r - xᵢ)² = r²,     0 ≤ xᵢ ≤ r
```

At the equal-price point, each four-asset coordinate is `q = r / 2`. The prototype normalizes token amounts to WAD, rejects overflow, rounds required inputs up, and rounds token payouts down. Normalization is accounting machinery—not a price oracle or a promise that an asset holds its peg.

### Tick planes and the aggregate torus

A tick is represented by a plane `α = k`, where `α = Σxᵢ / sqrt(n)`. Interior and boundary ranges combine into the fixed-partition aggregate invariant:

```text
(α_total - k_boundary - r_interior·sqrt(n))²
  + (||w|| - s_boundary)²
= r_interior²
```

`SegmentedTorus4` solves this bounded model by locating the next tick crossing, applying the partial transition, rebuilding the aggregate state, then continuing with remaining exact-input flow. The current implementation allows at most 16 configured ranges and 8 status transitions per swap; all-boundary continuation deliberately reverts rather than performing a partial settlement.

For derivations, rounding conventions, and unsupported branches, read the [protocol specification](docs/SPECIFICATION.md). The independent [Python reference guide](reference/README.md) describes the decimal model separately from Solidity's fixed-point implementation.

## What is implemented

| Capability | Current prototype behavior |
| --- | --- |
| Shared routing | Six canonical routes across USDC, USDT, DAI, and FRAX advance one logical reserve book. |
| Geometry | `Sphere4`, `Torus4`, and `SegmentedTorus4` provide bounded four-asset geometry, fixed-partition quotes, and tick trap/recovery transitions. |
| Swap domain | Canonical, exact-input pair swaps only; exact-output swaps are rejected. |
| v4 settlement | `beforeSwap` normalizes token decimals, charges a 0.05% input fee, prices the trade, mints input claims, burns output claims and returns the custom `BeforeSwapDelta`. Optional `hookData` carries `minAmountOut` and `deadline`. |
| Pool gating | `beforeInitialize` admits only the six canonical keys; `beforeAddLiquidity` rejects native v4 liquidity. |
| Range liquidity | `seed`, `addLiquidity`, `removeLiquidity` and `collectFees` move tokens through `PoolManager.unlock`. Shares and Q128 fee checkpoints live in `RangeFeeBook4`. |
| Solvency | `solvency()` compares held claims with rounded-up redeemable inventory plus unpaid fees; a fuzzed invariant keeps custody ≥ requirement. |
| Independent models | A Decimal Python reference and a dependency-free browser `BigInt` engine. Solidity, PoolManager settlement and the BigInt engine agree to the wei on shared vectors. |

### One basket, six routes

```mermaid
flowchart TB
    B[Shared four-asset reserve book]
    U1[USDC / USDT] --> B
    U2[USDC / DAI] --> B
    U3[USDC / FRAX] --> B
    U4[USDT / DAI] --> B
    U5[USDT / FRAX] --> B
    U6[DAI / FRAX] --> B
```

The pair interface chooses two assets from the basket; it does not own a separate liquidity allocation. Tests initialize all six pools on a real PoolManager and verify that a swap on any route moves only its two coordinates of the one shared book.

## Architecture and boundaries

```mermaid
sequenceDiagram
    participant Trader
    participant Hook as OrbitalV4Hook
    participant Engine as SegmentedTorus4
    participant Manager as v4 PoolManager

    Trader->>Manager: swap(exact input) via router
    Manager->>Hook: beforeSwap(canonical key, params, hookData)
    Hook->>Engine: quote net input (WAD) against shared reserve vector
    Engine-->>Hook: output, updated reserve state, tick statuses
    Hook->>Manager: mint input claims, burn output claims
    Hook-->>Manager: BeforeSwapDelta(+in, -out)
    Manager-->>Trader: router settles input and takes output
```

The hook checks canonical currency ordering, pair membership, the configured hook, fee, tick spacing, and callback authorization before state mutation. Callbacks without a permission bit explicitly revert.

The following are intentionally outside the current implementation boundary:

- A production router or position manager (the demo uses v4-core's `PoolSwapTest`), and mobile/WalletConnect wallets. The app supports injected browser wallets only.
- Generic asset counts, exact-output swaps, single-token LP entry, fee-on-transfer tokens, and rebasing tokens.
- All-boundary continuation, a proven fixed-point error budget, fee-rate governance, pause authority, and audits.
- Any assurance that a stablecoin depeg is harmless or that LP capital is protected.

The fuller list of obligations and safety limits lives in [the specification](docs/SPECIFICATION.md#failure-policy-and-unresolved-obligations) and [release notes](docs/RELEASE.md).

## Quick start

### Requirements

- Foundry `v1.7.1`
- Python `3.14.6`
- Node.js, Git, and Make

Clone recursively so the pinned Uniswap v4-core dependency is available:

```sh
git clone --recurse-submodules https://github.com/Sarnav07/Orbital.git
cd Orbital
```

Run the complete local validation suite:

```sh
make check
```

This checks Solidity formatting, builds the contracts and reports bytecode sizes. It then runs the Foundry suite (unit, PoolManager integration, cross-language vectors, scripts, gas, invariants), the independent Python reference tests, the simulator tests, and the app's unit/render tests, typecheck and production build.

To test the app against real contracts, run `make app-e2e` (requires anvil and jq). It deploys the demo to a throwaway anvil node and drives it with the app's own transaction builders.
- Swap output must equal the app's quote to the wei.
- A slippage revert must be decoded.
- Liquidity amounts must equal the on-chain previews.

`cd app && ORBITAL_LIVE_RPC=https://sepolia.unichain.org npx vitest run src/chain/live.testnet.test.ts` reads the live deployment (read-only).

Run the extended Foundry fuzz profile with:

```sh
cd contracts
FOUNDRY_PROFILE=ci forge test -vv
```

### Explore the frontend and simulator

The Vite/React interface has the protocol narrative, docs, and an app at `/app` with two tabs:

- **Testnet** trades the live Unichain Sepolia deployment.
  - Without a wallet, it shows the live book, range states, solvency and swap history.
  - With an injected wallet (MetaMask, Rabby, Coinbase… via EIP-6963) it can: switch to or add the network; mint mock tokens; approve, then swap with an exact quote and slippage-bounded `minAmountOut`; add or remove range liquidity at the on-chain preview amounts; and collect fees.
  - Every write is simulated before the wallet is asked to sign, and reverts are explained. You need Unichain Sepolia ETH for gas ([faucets](docs/REMAINING_WORK.md#b-needs-you)).
- **Sandbox** runs the same BigInt engine locally, with no wallet, and includes a depeg stress model.

```sh
cd app
npm install
npm run dev
```

The browser-native `BigInt` transition replayer and quote engine are available independently:

```sh
cd packages/simulator
npm test
```

See [`packages/simulator/README.md`](packages/simulator/README.md) for its scope and constraints.

### Deploy the frontend

The Vercel project is configured from the repository root because the React app imports the shared BigInt simulator and fixture packages:

```sh
npx vercel --prod
```

The root [`vercel.json`](vercel.json) installs and builds `app/`, publishes `app/dist`, and preserves the `/app` and `/docs` client-side routes.

Live frontend: [orbital-protocol-mu.vercel.app](https://orbital-protocol-mu.vercel.app)

### Deploy locally (anvil)

```sh
anvil &
cd contracts
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
POOL_MANAGER=0x0000000000000000000000000000000000000000 \
DEPLOYMENT_OUT=./deployments/anvil.json \
forge script script/DeployOrbitalDemo.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
```

With `POOL_MANAGER` set to zero, the script deploys a fresh PoolManager. It then deploys four mock tokens (public `mint`), mines and deploys the hook through the CREATE2 factory, deploys a `PoolSwapTest` router, initializes all six pools, and seeds the three ranges. On a local run, a 1,000 USDT → USDC swap sent with `cast` returned 999.433404 USDC for 1,232,869 gas.

## Deployment: Unichain Sepolia (chain 1301)

Deployed on 2026-09-24 from commit `ff686ea6d6794d9294862056951e294fb8bf975c` with `DeployOrbitalDemo.s.sol`. The broadcast started at block 63,408,440 (25 transactions). The full address list is in [`contracts/deployments/unichain-sepolia.json`](contracts/deployments/unichain-sepolia.json). Every contract has published source: the hook and fee book on Blockscout, and the router and mock tokens on [Sourcify](https://sourcify.dev) (exact match).

| Contract | Address |
| --- | --- |
| OrbitalV4Hook (verified) | [`0x10f107C223E83C0c3D43f3afe0eD75e0a06B2888`](https://unichain-sepolia.blockscout.com/address/0x10f107C223E83C0c3D43f3afe0eD75e0a06B2888) |
| RangeFeeBook4 (verified) | [`0xcd548fB545745cBF0beE4454f3c996b649ac38Be`](https://unichain-sepolia.blockscout.com/address/0xcd548fB545745cBF0beE4454f3c996b649ac38Be) |
| Demo router (v4-core `PoolSwapTest`, verified) | [`0x9EA2eB21BcF6178f1982d94181f6bc88A614dA42`](https://unichain-sepolia.blockscout.com/address/0x9EA2eB21BcF6178f1982d94181f6bc88A614dA42) |
| Uniswap v4 PoolManager (official) | [`0x00B036B58a818B1BC34d502D3fE730Db729e62AC`](https://unichain-sepolia.blockscout.com/address/0x00B036B58a818B1BC34d502D3fE730Db729e62AC) |
| Mock basket (address order, decimals, verified) | [USDT (6)](https://unichain-sepolia.blockscout.com/address/0x4eBEa178D6a3F18C166cb8C5b67BA73dBCD26b4A) · [FRAX (18)](https://unichain-sepolia.blockscout.com/address/0x68400C108461BD3D6F2124D6B81127D5f2c1EF65) · [DAI (18)](https://unichain-sepolia.blockscout.com/address/0xD3c22D959fE356a4C0AA6B2e3A8B2C6cf04F2Aae) · [USDC (6)](https://unichain-sepolia.blockscout.com/address/0xFc82C77256e74289f1B70f14126d21550C495a33) |

The hook address ends in `0x…2888`, which encodes `beforeInitialize`, `beforeAddLiquidity`, `beforeSwap` and `beforeSwapReturnDelta`. Constructor inputs are the sorted basket and decimals above, reserves of 15,000,000 WAD per asset, three 10M-WAD ranges at k/r 1.001 / 1.004 / 1.05, fee 500, tick spacing 60, and owner `0x54560095593B57Ad71572336037435Ff1E50E4EA`.

| Evidence | Transaction |
| --- | --- |
| Hook deployment (CREATE2 factory, 5,390,644 gas) | [`0xee3e34e9…eabe0`](https://unichain-sepolia.blockscout.com/tx/0xee3e34e9d7e3934b1536a2067b9b0a8d3bcf52ee214be9f8322dda226bbeabe0) |
| Range seeding (3.59M of each asset as PoolManager claims) | [`0x07fd74b7…e7220`](https://unichain-sepolia.blockscout.com/tx/0x07fd74b7193d74422cab2beaa5bcd42afdd7b0a344af56015deb33656b2e7220) |
| Live swap: 1,000 USDC → 999.4334 DAI, 0.5 USDC fee, `minAmountOut` + deadline hook data (1,232,232 gas) | [`0x23e33f62…19e46`](https://unichain-sepolia.blockscout.com/tx/0x23e33f62af47efb078152ae5d8ef18b144f65771b6bc2cf87c7414c353e19e46) |

These values were read back from the chain after the swap. `seeded()` is true. `reserves()` moved only the USDC and DAI coordinates. `solvency()` shows held claims equal to or above the requirement for every asset, and `feeLiability()` shows 0.5 USDC. Anyone can reproduce a swap: the mock tokens have a public `mint(address,uint256)`. Approve the router, then call `swap` with a canonical key (fee 500, tick spacing 60, this hook).

## Deployment posture

Unichain Sepolia is a testnet deployment of mock tokens for demonstration only. It is not a production launch, and the contracts are unaudited. To redeploy, copy `.env.example` to `.env`, add a funded testnet key, and run the demo script from `contracts/` with `--rpc-url $RPC_URL --broadcast`. Add `--verify` with the explorer's verifier settings to publish source.

## References and attribution

- [Paradigm: Orbital](https://www.paradigm.xyz/writing/orbital) — mathematical inspiration for the sphere and tick-boundary model.
- [Uniswap v4-core](https://github.com/Uniswap/v4-core) — pinned interface dependency.

Project code is independently authored. Attribution does not imply code reuse, equivalence to, endorsement by, or affiliation with these projects.

## License

This project is licensed under the [MIT License](LICENSE).
