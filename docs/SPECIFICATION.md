# Protocol specification

This document defines the implementation's conventions and requirements. It is not a claim that the full protocol has been implemented or verified. The mathematical source is [Paradigm's Orbital paper](https://www.paradigm.xyz/writing/orbital), particularly Sphere AMM, Tick Boundary Geometry, Tick Reserve Bounds and Capital Efficiency. Equations below are restated and derived for this implementation; no reference implementation code is copied.

## Scope and interfaces

The demo targets Unichain Sepolia with an immutable four-token mock basket: USDC/USDT use 6 decimals and DAI/FRAX use 18. These are test assets, not issuer-backed tokens. Six canonical Uniswap v4 pair interfaces access one logical reserve book through the hook. A pair interface does not own a separate allocation of liquidity.

Supported operations are exact-input swaps, proportional per-range liquidity entry/exit, per-range LP shares, and fee collection. Fee-on-transfer and rebasing tokens, exact-output swaps and single-token LP entry are outside the initial domain. Canonical token ordering, pair membership and hook callback authorization must be checked before state mutation.

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

The first Solidity geometry implementation fixes `n = 4`, so `sqrt(n) = 2` exactly in WAD. Its input radius is positive, even in WAD units, and at most `1e29`; these are arithmetic-domain limits, not liquidity limits. It calculates `q = r/2`, `k_min = r`, `k_max = 3r/2`, `s² = (k-r)(3r-k)`, and uses a floored WAD square root. The `sqrt(3)` coefficient is a floored WAD constant. Every value is therefore directionally rounded down and differs from the Decimal reference by a bounded amount. The segmented WAD fixture matches the Decimal reference to 18 decimals (`40.123552802932248591…`), and the Solidity engine, the PoolManager settlement path and the BigInt simulator agree exactly on the shared vectors in `packages/fixtures/quote-vectors-v1.json`.

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

Fixed-partition quotes do not discover a tick crossing and must not be settled as if their partition remained valid after one; `SegmentedTorus4` (below) performs the crossing. Fees and real-inventory constraints live in the hook, not in this quote library.

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

### v4 adapter and settlement

`OrbitalV4Hook` is the protocol adapter and custodian. Its constructor receives a manager address, a strictly address-sorted immutable four-currency registry, each currency's decimals, a matched initial reserve vector, the bounded tick set, the pool fee, tick spacing and an owner. It deploys its own `RangeFeeBook4` as the LP share and fee ledger. The constructor calls `Hooks.validateHookPermissions`, so a deployment at an address that does not encode the permission flags reverts.

Permissions are `beforeInitialize`, `beforeAddLiquidity`, `beforeSwap` and `beforeSwapReturnDelta` (flag bits `0x2888`). `beforeInitialize` accepts only the six canonical keys: two distinct registered currencies in address order, this hook, the configured fee and spacing. `beforeAddLiquidity` always reverts, so native concentrated liquidity cannot be attached to Orbital pools. Every other callback reverts.

For an accepted exact-input route, `beforeSwap`:

1. Rejects exact-output input and swaps before seeding.
2. Decodes optional `hookData = abi.encode(uint256 minAmountOut, uint256 deadline)`; empty data applies no guard.
3. Takes the fee `ceil(amountIn * fee / 1e6)` in raw input units, converts the net input to WAD exactly with `TokenUnits.toWad`, and runs `SegmentedTorus4` on the shared reserve vector.
4. Converts the WAD output with `TokenUnits.fromWadDown`; the unpaid WAD remainder stays in custody as non-redeemable dust.
5. Requires every reserve to stay at or above the sum of range virtual offsets (real inventory cannot go negative).
6. Persists the reserve vector, aggregate state and tick statuses, credits the fee to ranges that were interior when the swap started (weighted by radius), then mints the gross input as PoolManager ERC-6909 claims and burns output claims.
7. Returns `BeforeSwapDelta(+amountIn, -amountOut)`, which replaces the concentrated-liquidity leg. The swapper's router settles its side in the same unlock.

Custody is held entirely as PoolManager claims. `solvency()` compares held claims with the required amount: `ceil((reserve_i - Σ virtualOffset) / 10^(18-decimals_i)) + unpaid fees_i`. Tests and a fuzzed invariant assert that custody always covers it.

Range liquidity enters only through the hook:

- `seed(recipient)` (owner, once) pulls each asset's real inventory at the configured state and mints one share per WAD of range radius. `MIN_LOCKED_SHARES` of each range are locked to `address(0)` so a range can never be emptied into an unpriceable zero-radius tick.
- `addLiquidity(rangeId, shares, maxAmountsIn, deadline)` and `removeLiquidity(rangeId, shares, minAmountsOut, deadline)` scale that range's radius and `k` by the share ratio, keeping `k/r` fixed, and move its attributed coordinate by the same ratio. The torus invariant is re-checked. Rounding favours the pool: additions round the radius (to an even WAD value) and coordinates up; removals round them down. The user pays or receives the change in required raw inventory, so custody minus requirement never decreases.
- `collectFees(rangeId, recipient)` pays the caller's checkpointed fees for one range.

`previewAddLiquidity`, `previewRemoveLiquidity` and `seedAmounts` expose the exact amounts.

### Range attribution and LP claims

`RangeLiquidity4` derives each tick's coordinate from the current aggregate reserve vector and its recorded interior/boundary status. Interior ranges receive the shared centered direction in proportion to radius; boundary ranges receive it in proportion to their boundary-sphere radius. Each range's virtual offset is the tick's `x_min`, and its redeemable inventory is `coordinate - virtualOffset` per asset. Virtual offsets are not an LP claim.

This derivation is defined in both interior and boundary states. It does not impose a pool-wide withdrawal freeze when one range is trapped. Fixed-point directional allocation can differ from the aggregate coordinate by a bounded number of WAD-wei; it is non-redeemable attribution dust, never assigned to an LP by rounding.

`RangeShareBook4` stores claims by `(rangeId, owner)`. Bootstrap assigns a specified initial share supply to the attributed inventory of one range. Subsequent deposits must reproduce that range's current four-asset inventory ratio exactly; the matching shares are minted to the depositor. A burn returns the proportional real inventory of that same range, with a full burn returning every remaining unit. No operation reads a global pool pro-rata balance or another range's inventory. `RangeShareBook4` is a standalone, controller-only accounting primitive. The hook itself does not use it: it derives range inventory live from the reserve book and keeps shares in `RangeFeeBook4`, so no stored inventory can go stale after swaps.

### Fee growth and dust policy

`RangeFeeBook4` is the hook's LP ledger. It records shares per range and fee growth per range and per asset in Q128 units per share, so six-decimal raw fees remain claimable against WAD-scale share supplies. A settled swap segment supplies its participating range IDs and nonzero weights; the segment's fee amount is split by those weights, then each range's allocation is converted to per-share growth. LP balances checkpoint before every mint or burn, so newly minted shares cannot claim prior growth and burned shares retain already-accrued claims. Only the controller (the hook) can mint, burn, accrue or collect; collection returns an owner's checkpointed claim for that range only.

Two rounding stages are explicit: a segment's integer split remainder, and the remainder when a range allocation becomes per-share growth. Both are accumulated as non-redeemable, per-asset dust rather than assigned by an arbitrary last-recipient rule. The hook supplies the fee inputs from real settled swaps and pays collections from its PoolManager claims. There is no fee-rate governance or pause authority: the fee is immutable per deployment.

LP shares refer to one normalized range, not a global pro-rata claim over differently exposed ranges. Proportional entry/exit refers to that range's current attributed basket, not automatically equal dollar deposits. Fee collection cannot withdraw principal. Deposits cannot claim pre-existing fees. Fee allocation policy: a swap's fee is split across the ranges that were interior when it started, weighted by radius. Ranges trapped at a boundary during the whole swap earn nothing from it. This is a deliberate prototype simplification: a range that becomes trapped mid-swap still receives a full share, and boundary ranges that absorb part of a crossing trade are not credited.

Range identity uses lambda, not radius or absolute k. The reference reports an exact rational k/r for supplied finite decimals. Approximate equality must not merge ranges. The future on-chain range grid/encoding needs its own derivation; reference Decimal rounding is not the grid.

## Failure policy and unresolved obligations

Reject invalid dimensions, nonfinite/negative quantities, unsupported decimals, invalid ranges, invalid sphere states, singular rates and overflow. The geometry reference rejects out-of-bound k rather than silently clamping inputs. Trade execution rejects insufficient real inventory, invalid solution branches, convergence/crossing limits, unsupported pairs, unauthorized callbacks, stale deadlines and inadequate minimum outputs.

Implemented since the initial specification: WAD normalization in the adapter, real PoolManager settlement with claim custody, deterministic hook-address mining through the CREATE2 factory, canonical pool initialization, range liquidity entry/exit and fee settlement.

The following remain deliberately unresolved, and block the corresponding claims:

- All-boundary continuation. A swap that would trap every range reverts in full.
- Fee-rate governance, pause authority and protocol fees.
- A proven error budget for the fixed-point solver beyond the current `1e-9` relative-residual acceptance rule, and gas limits for pathological crossing sequences (measured: 1.22M ordinary, 3.14M one crossing, 4.80M two crossings).
- A public router or position manager beyond v4-core's `PoolSwapTest` demo router.
- Fee-on-transfer, rebasing or non-standard tokens, and any audit or economic review.

The sphere reference is not a swap engine, LP accountant or proof of depeg protection. Those components must satisfy the conservation requirements separately.
