# Paper-to-implementation ledger

## Source and evidence policy

**Source:** *Orbital*, by Dan Robinson, Ciamac Moallemi and Dave White (Paradigm, 2025), [official publication](https://www.paradigm.xyz/writing/orbital).

- **Division of roles:** the paper supplies the mechanism. [MATH.md](MATH.md) supplies the translated coordinates and the local derivations (`MATH-n`). [TESTS.md](TESTS.md) supplies the cases that accept them.
- **What counts as a status:** a requirement being written down proves nothing. The status column below cites only tests that run in `make check` or `make app-e2e`, or recorded on-chain evidence.
- **Authorship:** the project code is independently authored. [Oxkai/Orbital.Hook](https://github.com/Oxkai/Orbital.Hook) was consulted as a reference; no code is copied.

## Scope

**Deployed demo:**
- **Network and basket:** an immutable four-token mock basket, deployed on **Unichain Sepolia** (chain 1301, featured), Ethereum Sepolia, Arbitrum Sepolia and Arc Testnet. USDC and USDT use 6 decimals; DAI and FRAX use 18. These are test assets, not issuer-backed tokens.
- **Access:** six canonical Uniswap v4 pools reach one shared reserve book through the hook. A pool does not own a separate allocation of liquidity.

**Supported:**
- exact-input swaps
- proportional per-range liquidity entry and exit
- per-range LP shares
- fee collection

**Out of domain:**
- exact-output swaps
- single-token LP entry
- fee-on-transfer and rebasing tokens

## Traceability

| Mechanism / requirement | Implementation | Acceptance / current status |
| --- | --- | --- |
| Sphere, equal-price point, spherical caps (`MATH-1…5`) | `reference/orbital/geometry.py`; `contracts/src/math/Sphere4.sol` | Hand-derived n = 2, 3, 4 ticks, endpoints, scale invariance and fixed-point bounds pass (GEO). The Decimal reference and Solidity are independent. |
| Aggregate torus for a fixed partition (`MATH-6`, `MATH-11`) | `Torus4.sol` | Interior sphere quote, boundary aggregate matching the Python fixture, and fuzzed bounded-invariant quotes pass (SW). |
| Crossing and recovery (`MATH-7`, `MATH-8`, `MATH-12`) | `reference/orbital/segmented.py`; `SegmentedTorus4.sol` | Trap, recover, tied ranges and explicit all-boundary rejection pass in Python and Solidity (CROSS). Exact parity with the Decimal reference holds on the fixture. |
| Single-depeg interpretation (`MATH-9`) | Python reference; `app/src/simulator.ts` `singleDepegTrapPrice` | The depeg boundary matches the price vector in the reference; the app's inversion is tested for display use only (GEO, APP). |
| Range attribution (`MATH-10`) | `RangeLiquidity4.sol`; BigInt `attributeRanges` | Interior and boundary attribution tests pass. BigInt and Solidity agree to the wei after every vector step (LP, PARITY). |
| Decimals and rounding (`MATH-13`, `MATH-14`) | `TokenUnits.sol`; `OrbitalV4Hook.beforeSwap` | Rounding direction, overflow and 6↔18-decimal settlement pass through a real PoolManager (FEE, SETTLE). |
| Fee allocation and checkpoints (`MATH-15`) | `RangeFeeBook4.sol` (Q128 growth) | Weighted allocation, no claims on earlier fees, and small raw fees against large supplies pass. Collection through the hook passes (FEE). |
| Liquidity scaling (`MATH-16`) | `OrbitalV4Hook._previewRangeChange` | Add/remove round trips lose at most 3 raw units, including a trapped range. Previews equal the amounts moved (LP, E2E). |
| Solvency (`MATH-17`) | `OrbitalV4Hook.solvency` (a view; solvency follows from the rounding rules, not a runtime check) | Asserted in most integration tests, plus a fuzzed invariant over random swaps, liquidity changes and collections (SETTLE, INV). |
| v4 settlement | `OrbitalV4Hook.sol` (claims custody, `BeforeSwapDelta`) | All six pools on one book, exact-output and native-liquidity rejection, and canonical-only initialization pass. There is a **live swap on each of the four networks** ([README](../README.md#deployed-contracts)) (SETTLE). |
| Deterministic hook address | `HookAddressMiner.sol`; `script/OrbitalDeployBase.sol` | Salt is mined against the CREATE2 factory. The scripts are executed in tests and broadcast on anvil. Every live hook's address carries the four permission flags (`0x2888`) in its low 14 bits (DEPLOY). |
| Cross-language parity (`MATH-18`, `MATH-19`) | `packages/simulator`; `packages/fixtures/quote-vectors-v1.json` | Solidity engine, manager settlement and BigInt agree to the wei. The app quote reproduces the live swap (PARITY, APP). |
| App transaction path | `app/src/chain/*` | Selectors checked against the sources. Builders are driven against a real anvil deployment (E2E). |
| Range status consistency | `SegmentedTorus4._flipSettled` (and its JS/Python mirrors) | A trade that ends exactly on a range's plane leaves the range consistent. The next trade away from the plane flips it first, so a range never trades past its bound or stays boundary inside its band (BOUNDARY). |

## State and conservation requirements

The logical basket state distinguishes:

- The immutable token registry, decimals and pair-to-basket mapping (hook immutables and storage).
- Each range's radius, boundary, interior/boundary status, LP supply and fee checkpoints. Per-range virtual offsets and redeemable inventory are derived live (`MATH-10`), so they cannot go stale after swaps. Only their aggregate, the total virtual offset, is cached; it changes only when a range is resized.
- The aggregates used to price trades (`r_int`, `k_bound`, `s_bound`), which are recomputed and cross-checked before every swap.
- Custody (PoolManager ERC-6909 claims), unpaid fee liabilities and rounding dust per asset.

Rules:
- **Virtual offsets:** never redeemable.
- **Custody:** at settled operation boundaries, custody covers real inventory plus accrued fees without double counting (`MATH-17`).
- **Pending deltas:** v4 deltas settle inside the same `unlock`.
- **One book:** a swap through any pool changes the same basket.
- **Failures:** any failure reverts the entire operation.

## Failure policy

Rejected inputs and states:
- invalid dimensions
- non-finite or negative quantities
- unsupported decimals
- invalid ranges and invalid sphere states
- singular rates and overflow

Out-of-bound `k` is rejected, never silently clamped.

Trade execution rejects:
- insufficient real inventory
- invalid solution branches
- convergence and crossing limits
- unsupported pools and unauthorized callbacks
- stale deadlines and inadequate minimum outputs, when the swap supplies hook data (the app always does; empty hook data means no guard)

## Open obligations

These remain deliberately unresolved, and each blocks the corresponding claim:

- **All-boundary continuation.** A swap that would trap every range reverts in full.
- **Error budget.** There is no proven fixed-point error budget beyond the `1e-9` relative-residual acceptance rule. Measured gas: 1.22M for an ordinary swap, 3.15M with one crossing, 4.81M with two ([gas baseline](results/gas-baseline.md)).
- **Fee policy simplification.** A range trapped mid-swap still receives a full share, and boundary ranges that absorb part of a crossing trade are not credited.
- **Governance and routing.** No fee governance, protocol fee or pause authority. No production router or position manager beyond v4-core's `PoolSwapTest`.
- **Tokens and review.** Non-standard tokens are unsupported. There has been no professional audit or economic review, only the internal review in [AUDIT.md](AUDIT.md).

The reference model is not a swap engine, an LP accountant or a proof of depeg protection. Those components satisfy the conservation requirements separately, and only to the extent their tests show.
