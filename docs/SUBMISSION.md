# Orbital: submission sheet

Copy from here into the submission form. Fields marked **TODO (you)** need your input.

## Basics

| Field | Value |
| --- | --- |
| Project | **Orbital: one reserve book for n stablecoins** |
| One-liner | An experimental Uniswap v4 hook that trades n stablecoins through one shared, concentrated reserve book instead of n(n − 1)/2 separately funded pair pools. It is live as a 4-coin book on Unichain Sepolia. |
| Repository | https://github.com/Sarnav07/Orbital |
| Live app | https://orbital-protocol-mu.vercel.app/app (Uniswap-style interface: Swap, Pools and Explore on the live contracts, with a network selector; Sandbox has the local model and depeg stress) |
| Documentation | https://orbital-protocol-mu.vercel.app/docs (protocol guide) · [MATH](MATH.md) · [PAPER_IMPLEMENTATION](PAPER_IMPLEMENTATION.md) · [TESTS](TESTS.md) |
| Networks | Unichain Sepolia (1301, featured), Ethereum Sepolia (11155111), Arbitrum Sepolia (421614), Arc Testnet (5042002): one pool each, listed on the app's Pools page |
| Hook | [`0x10f107C223E83C0c3D43f3afe0eD75e0a06B2888`](https://unichain-sepolia.blockscout.com/address/0x10f107C223E83C0c3D43f3afe0eD75e0a06B2888), source-verified |
| Live swap | [1,000 USDC → 999.4334 DAI](https://unichain-sepolia.blockscout.com/tx/0x23e33f62af47efb078152ae5d8ef18b144f65771b6bc2cf87c7414c353e19e46) |
| Demo video | **TODO (you)**: paste the URL after recording ([script](DEMO_SCRIPT.md)) |
| Final commit | **TODO (you)**: `git rev-parse HEAD` on `main` after the last merge |
| Team / contact | **TODO (you)** |

## Description

Stablecoins share a peg, but pair-based AMMs split their liquidity. n coins need n(n − 1)/2 pools: six for four coins, twenty-eight for eight. Depth on one pair does nothing for the others. Orbital puts every coin in one reserve book, based on Paradigm's n-dimensional Orbital geometry. LPs choose how tightly to concentrate around the peg by picking a range (a "tick" on an n-dimensional sphere). The pair pools are only entry points to that book. The deployed instance is the n = 4 case: USDC, USDT, DAI and FRAX across six Uniswap v4 pools on Unichain Sepolia.

The hook implements the whole path on real v4 infrastructure:

- **Pricing.** Bounded sphere/torus geometry (`Sphere4`, `Torus4`, `SegmentedTorus4`) prices each exact-input swap. It detects when a range reaches its boundary and continues the trade across up to eight boundary crossings.
- **Settlement.** `beforeSwap` converts token decimals to WAD, charges a 0.05% fee, takes the input as PoolManager ERC-6909 claims and burns claims to pay the output. It returns the custom `BeforeSwapDelta`. Optional hook data enforces `minAmountOut` and a deadline.
- **Liquidity.** Range liquidity enters and leaves through the hook (`seed`, `addLiquidity`, `removeLiquidity`, `collectFees`). Each range's inventory is attributed from the shared book, and fees accrue per range. Native v4 liquidity and non-canonical pools are rejected.
- **Solvency.** `solvency()` shows that held claims cover every range's redeemable inventory plus unpaid fees. A fuzzed invariant enforces this across random swaps and liquidity changes.

## What makes it credible

- **Independent implementations agree:**
  - The Solidity engine, settlement through a real PoolManager, and the browser's BigInt engine agree to the wei on a shared vector file that includes tick crossings, recovery and per-range attribution.
  - An independent Decimal Python reference matches the Solidity crossing fixture to 18 decimals.
  - The app's quote reproduces the live testnet swap exactly: `999433404420670936920` DAI wei.
- **The app is tested against real contracts.** `make app-e2e` deploys the demo to a local anvil node and drives it with the app's own transaction builders: swap output equals the quote, a slippage revert is decoded, and liquidity amounts equal the on-chain previews.
- **Test totals:** 65 Solidity tests (PoolManager integration, deployment scripts, gas budgets, 2 invariant campaigns), 31 Python, 12 simulator, 59 app unit/render tests and 4 E2E tests. CI runs all of them.
- **Static analysis:** Slither was run and every finding triaged ([report](results/static-analysis.md)). There is no High or Medium true positive; one Low, fail-closed issue is documented along with its fix.
- **The demo is honest about limits.** It includes a depeg stress model. When one coin floods the book, the narrow ranges trap near $0.90 and $0.80 and stop absorbing it, while the wide range keeps trading. The run stops with an explicit reason when every range would trap.

## How to verify

```sh
git clone --recurse-submodules https://github.com/Sarnav07/Orbital.git && cd Orbital
make check     # Foundry, Python reference, simulator, app tests, typecheck, build
make app-e2e   # needs anvil + jq: deploy locally, then drive with the app's builders
```

To check all four live deployments read-only: `cd app && ORBITAL_LIVE=1 npx vitest run src/chain/live.testnet.test.ts`.

## Limits (stated, not hidden)

- Unaudited prototype on mock tokens.
- Exact-input swaps only; at most eight range crossings per swap. A swap that would trap every range reverts.
- The demo router is v4-core's `PoolSwapTest`; there is no production router or position manager. Only injected browser wallets are supported.
- No fee governance or pause authority. Fees go to ranges that were interior when the swap started.

The full list is in [REMAINING_WORK.md](REMAINING_WORK.md#c-known-limits-deliberately-not-addressed) and the [implementation ledger](PAPER_IMPLEMENTATION.md#open-obligations).

## Attribution

- Mathematical basis: [Paradigm's Orbital research](https://www.paradigm.xyz/writing/orbital).
- Settlement: [Uniswap v4-core](https://github.com/Uniswap/v4-core), a pinned dependency.
- [Oxkai/Orbital.Hook](https://github.com/Oxkai/Orbital.Hook) was consulted as a reference.
- The project code is independently authored.
