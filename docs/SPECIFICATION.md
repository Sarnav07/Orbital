# Protocol specification

This document defines the implementation's conventions and requirements. It is not a claim that the full protocol has been implemented or verified. The mathematical source is [Paradigm's Orbital paper](https://www.paradigm.xyz/writing/orbital), particularly Sphere AMM, Tick Boundary Geometry, Tick Reserve Bounds and Capital Efficiency. Equations below are restated and derived for this implementation; no reference implementation code is copied.

## Scope and interfaces

The demo targets Unichain Sepolia with an immutable four-token mock basket: USDC/USDT use 6 decimals and DAI/FRAX use 18. These are test assets, not issuer-backed tokens. Six canonical Uniswap v4 pair interfaces access one logical reserve book through the hook. A pair interface does not own a separate allocation of liquidity.

Supported operation targets are exact-input swaps, proportional basket liquidity entry/exit, per-range LP shares, and fee collection. Fee-on-transfer and rebasing tokens, exact-output swaps and single-token LP entry are outside the initial domain. Canonical token ordering, pair membership and hook callback authorization must be checked before state mutation.

## Coordinates and units

| Symbol | Meaning |
|---|---|
| `n` | Asset count; reference geometry supports integer n >= 2; demo fixes n = 4 |
| `r` | Positive sphere radius, in normalized token units |
| `x_i` | Mathematical reserve coordinate, including the virtual offset |
| `v` | Unit diagonal vector `(1,...,1)/sqrt(n)` |
| `alpha` | `dot(x,v) = sum(x_i)/sqrt(n)` |
| `k` | Tick boundary projection, with plane `alpha = k` |
| `lambda` | Dimensionless range identity `k/r`, independent of liquidity size |
| `s` | Radius of the sphere/plane intersection in the orthogonal subspace |
| `b` | Per-token virtual offset, equal to the tick's minimum mathematical reserve |
| `a_i` | Real tradable inventory attributed to a tick: `x_i - b` |

In particular, `k` is NOT `sum(x_i)`. That sum on the boundary is `k*sqrt(n)`. Physical amounts and geometric coordinates have different accounting roles even when both use normalized token units.

Solidity normalization is WAD (10^18 units per token). Raw amounts multiply by `10^(18-decimals)` exactly with overflow rejection. Required raw inputs round up; token payouts round down. Retained dust must be separately reconciled. Neither normalization nor the equal-price point is an oracle or a guarantee of a dollar peg.

The Python reference uses decimal token quantities, not WAD integers. It accepts Decimal, integer and decimal string inputs, rejects binary floats and nonfinite values, and controls its own precision. A reference-model tolerance is not an approved Solidity error budget.

## Sphere and tick geometry

The nonnegative-price sphere branch has `0 <= x_i <= r` and:

```text
sum((r - x_i)^2) = r^2
q = r * (1 - 1/sqrt(n))                  # equal reserve per asset
output_j / input_i (infinitesimal) = (r - x_i) / (r - x_j)
k_min = r * (sqrt(n) - 1)
k_max = r * (n - 1) / sqrt(n)
```

The rate is output token j per input token i, before fees; its inverse is a different quote. A zero denominator is singular and rejected by the reference rate API. Zero numerators with positive denominators give zero output rates.

A tick is the cap containing q with `alpha <= k`, not a disjoint Uniswap price interval. For `k_min <= k <= k_max`, intersecting the sphere with `alpha = k` gives center `k*v` in reserve coordinates and:

```text
s^2 = r^2 - (k - r*sqrt(n))^2
m = k / sqrt(n)
d = sqrt((n-1)/n) * s
x_min = m - d
x_max = min(r, m + d)
real_reserve_at_peg = q - x_min
capital_efficiency_at_peg = q / (q - x_min)
```

Derivation: write `x = k*v + w` where sum(w) = 0 and norm(w) = s. The projection of a coordinate axis into that subspace has norm sqrt((n-1)/n), giving the coordinate extrema above. For the minimum coordinate, each other coordinate is `(k*sqrt(n)-x_min)/(n-1)`. The maximum expression is clipped to the nonnegative-price branch; when clipping occurs, do not assume that setting all other coordinates equal still describes a boundary point.

The reference evaluates equivalent factorizations to reduce cancellation: `s^2 = (k-k_min)*(2r-(k-k_min))` and `x_min = (k_max-k)^2/(m+d)`. The latter follows from `m^2-d^2 = (k_max-k)^2` and preserves very small virtual offsets near the maximum tick.

The zero-width endpoint `k_min` is supported analytically: s = 0, x_min = x_max = q, real deposit = 0. Efficiency is undefined (reported as `None`), not an investable infinite-return position. Creating such an LP range must be rejected. At `k_max`, x_min = 0 and efficiency = 1. Increasing r and k by the same factor scales quantities but preserves lambda and concentration.

### Four-asset fixed-point prototype

The first Solidity geometry implementation fixes `n = 4`, so `sqrt(n) = 2` exactly in WAD. Its input radius is positive, even in WAD units, and at most `1e29`; these are arithmetic-domain limits, not liquidity limits. It calculates `q = r/2`, `k_min = r`, `k_max = 3r/2`, `s² = (k-r)(3r-k)`, and uses a floored WAD square root. The `sqrt(3)` coefficient is a floored WAD constant. Every value is therefore directionally rounded down and is expected to differ from the Decimal reference by a bounded amount. The next chunk must derive those bounds and compare implementation vectors before this geometry quotes trades.

## Aggregate invariant and segmented reference trades

For a fixed interior/boundary partition, let `r_int` be the sum of interior radii, `k_bound` the sum of boundary `k` values, and `s_bound` the sum of boundary radii. For total reserves `x_total`, set `alpha_total = sum(x_total)/sqrt(n)` and `w_norm = sqrt(sum((x_i - mean(x))²))`. The aggregate invariant is:

```text
(alpha_total - k_bound - r_int*sqrt(n))² + (w_norm - s_bound)² = r_int²
```

All interior ticks share a normalized reserve direction. They remain interior exactly while `alpha_int/r_int < k/r`; a rising normalized projection traps the smallest crossed interior boundary, while a falling projection recovers the largest crossed boundary tick. A trade must solve the fixed-partition invariant, then segment at the first boundary if that assumption is violated. At a crossover to normalized boundary `lambda`, the total reserve sum is fixed at `(r_int*lambda + k_bound)*sqrt(n)`, so `input - output` is fixed. This reduces the crossover to one physical root, which the reference brackets independently.

The current reference applies no fees and uses Decimal bracketing rather than a Solidity solver. It supports an interior sphere plus one or more boundary ranges and validates the aggregate residual after every segment. It explicitly rejects all-boundary continuation, LP accounting, and any claim about settlement. Those are later implementation obligations.

### Fixed-partition Solidity quote solver

`Torus4` implements the aggregate invariant for exactly four assets with a caller-supplied fixed partition: `rInterior`, `kBoundary`, and `sBoundary`. It recomputes `alpha_total` and `||w||` from a four-asset WAD reserve vector, then quotes an exact-input swap by scanning 48 output intervals and bisecting the first sign-changing residual bracket for at most 96 iterations. It returns no state mutation.

The solver rejects zero input, identical/out-of-range assets, output reserves below two raw WAD units, invalid initial aggregate state, unsupported all-boundary continuation, reserve-domain overflow, no physical root, and a candidate whose relative aggregate residual exceeds `1e-9`. That numerical acceptance bound is temporary solver-domain policy, not a claim about economic error, slippage, LP solvency or a final protocol tolerance. It is measured against `rInterior²` and will be re-evaluated alongside fixed-point differential vectors.

Fixed-partition quotes do not discover a tick crossing and must not be settled as if their partition remained valid after one. The next chunk must locate the first crossing, solve only to that boundary, update the aggregate state, and continue with the remaining input. Fees and real-inventory constraints are also outside this quote library.

### Tick crossing and recovery

`SegmentedTorus4` receives an explicit, bounded range list (`radius`, `k`, status) plus a matching aggregate state. It recomputes the aggregate before trading and rejects a mismatch. For a candidate fixed-partition quote, it calculates `alpha_int/r_int`: on a rising value it selects the smallest crossed interior `k/r`; on a falling value it selects the largest crossed boundary `k/r`. Ranges with exactly the same normalized boundary flip together.

At the boundary, the target total reserve sum is `2 * (r_int * (k/r) + k_bound)` for the four-asset prototype. Thus `input - output` is fixed; the engine brackets and bisects the one remaining physical root, applies that partial trade, rebuilds `rInterior/kBoundary/sBoundary`, and continues. It caps the input range list at 16 and a swap at 8 status transitions. The returned status bitmap and crossing count are computed from the actual transition sequence, not inferred from final balances.

An all-boundary continuation is currently unsupported and reverts the whole transaction. This is deliberate: it does not produce a partial settlement or silently discard a rounding remainder. Exact boundary landing and an all-boundary AMM mode require a separately specified fixed-point policy before being enabled.

For a single-depeg scenario with one price p relative to the other equal prices:

```text
k(p) = r*sqrt(n) - r*(p+n-1)/sqrt(n*(p^2+n-1)),  0 <= p <= 1
```

This is a scenario-specific interpretation, not a universal multi-asset price floor. Wider ticks may remain interior even when that coin reaches zero price.

## State and conservation requirements

The logical basket state must distinguish:

- The immutable token registry, decimals and pair-to-basket mapping.
- Each normalized range's radius, boundary, virtual offset, attributed real inventory, interior/boundary status, LP supply and fee checkpoints.
- Aggregates used to price trades, and recomputable sums for invariant checks.
- Custody/claim balances, uncollected fee liabilities, and rounding dust per asset.

Virtual offsets are never redeemable. At settled operation boundaries, accounted custody must cover real inventory plus separately accrued fees and assigned dust, without counting the same balance twice. Pending v4 deltas must settle before an operation completes. Swaps through any pair change the same basket state. A failure reverts the entire operation.

### Current v4 adapter boundary

`OrbitalV4Hook` is the first protocol adapter over the bounded four-asset engine. Its constructor receives a manager address, a strictly address-sorted immutable four-currency registry, a matched initial reserve vector, and the bounded tick set. It accepts a `PoolKey` only when it has two distinct registered currencies in canonical address order, the hook address, and the configured fee and tick spacing. It supports exact-input swaps only.

For an accepted route, `beforeSwap` identifies the pair's two indices in the one shared reserve vector, runs `SegmentedTorus4`, persists the resulting aggregate state and tick statuses, then returns a v4 `BeforeSwapDelta`: positive specified input and negative unspecified output. This is the v4 convention that replaces the concentrated-liquidity leg with the hook's custom curve result. The adapter implements every `IHooks` selector, but all callbacks other than `beforeSwap` explicitly revert.

The repository also includes a minimal manager-side accounting fixture. It invokes the hook as its configured manager, decodes v4's `BeforeSwapDelta`, and records the input receipt and output payment by currency. It proves that two different canonical pair routes change the same four-asset book and that their custom-delta legs can be accounted for independently. The fixture does not imitate PoolManager internals, transfer ERC-20 balances, initialize pools, or prove production settlement.

The required deployment permission pattern is `beforeSwap` plus `beforeSwapReturnDelta`. This implementation exposes that pattern for the later deterministic address-mining/deployment step, but deliberately does not validate the constructor address yet. Until that step and a real PoolManager settlement flow are implemented, no statement of testnet readiness is warranted.

### Range attribution and LP claims

`RangeLiquidity4` derives each tick's coordinate from the current aggregate reserve vector and its recorded interior/boundary status. Interior ranges receive the shared centered direction in proportion to radius; boundary ranges receive it in proportion to their boundary-sphere radius. Each range's virtual offset is the tick's `x_min`, and its redeemable inventory is `coordinate - virtualOffset` per asset. Virtual offsets are not an LP claim.

This derivation is defined in both interior and boundary states. It does not impose a pool-wide withdrawal freeze when one range is trapped. Fixed-point directional allocation can differ from the aggregate coordinate by a bounded number of WAD-wei; it is explicitly non-redeemable attribution dust and is carried forward for C10 reconciliation rather than assigned to an LP by rounding.

`RangeShareBook4` stores claims by `(rangeId, owner)`. Bootstrap assigns a specified initial share supply to the attributed inventory of one range. Subsequent deposits must reproduce that range's current four-asset inventory ratio exactly; the matching shares are minted to the depositor. A burn returns the proportional real inventory of that same range, with a full burn returning every remaining unit. No operation reads a global pool pro-rata balance or another range's inventory. The current book is an accounting component: ERC-20 custody, hook callback authorization, post-swap share-state synchronization, and fee liabilities remain later integration work.

### Fee growth and dust policy

`RangeFeeBook4` records fee growth per range and per asset in WAD units per LP share. A settled swap segment supplies its participating range IDs and nonzero weights; the segment's fee amount is split by those weights, then each range's allocation is converted to per-share growth. LP balances checkpoint before every mint or burn, so newly minted shares cannot claim prior growth and burned shares retain already-accrued claims. Collection returns the caller's checkpointed claim for that range only.

Two rounding stages are explicit: a segment's integer split remainder, and the remainder when a range allocation becomes per-share growth. Both are accumulated as non-redeemable, per-asset dust rather than assigned by an arbitrary last-recipient rule. This commit defines accounting math only: C11 must connect fee inputs to actual v4 settlement and C10 does not introduce a fee rate, pause authority, or ERC-20 transfers.

LP shares refer to one normalized range, not a global pro-rata claim over differently exposed ranges. Proportional entry/exit refers to that range's current attributed basket, not automatically equal dollar deposits. Fee collection cannot withdraw principal. Deposits cannot claim pre-existing fees. The fixed fee's value and allocation among participating ticks must be specified before fee code; boundary status alone does not imply zero participation.

Range identity uses lambda, not radius or absolute k. The reference reports an exact rational k/r for supplied finite decimals. Approximate equality must not merge ranges. The future on-chain range grid/encoding needs its own derivation; reference Decimal rounding is not the grid.

## Failure policy and unresolved obligations

Reject invalid dimensions, nonfinite/negative quantities, unsupported decimals, invalid ranges, invalid sphere states, singular rates and overflow. The geometry reference rejects out-of-bound k rather than silently clamping inputs. Later trade execution must reject insufficient real inventory, invalid solution branches, convergence/crossing limits, unsupported pairs, unauthorized callbacks, stale deadlines and inadequate minimum outputs.

The following are deliberately unresolved, and block the corresponding implementation claims:

- All-boundary continuation, production branch-selection bounds and fixed-point torus solving.
- ERC-20 custody, hook-authorized share mutations, post-swap inventory synchronization and reconciliation of on-chain balances with recorded claims/dust.
- Fee-rate governance, pause authority and actual v4 fee settlement.
- Fixed-point geometry format, supported radius/range grid, numeric tolerances and gas/iteration limits.
- Production v4 settlement, deterministic hook-address mining, pool initialization and deployment-specific integration tests.

The sphere reference is not a swap engine, LP accountant or proof of depeg protection. Those components must satisfy the conservation requirements separately.
