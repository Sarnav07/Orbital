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

LP shares refer to one normalized range, not a global pro-rata claim over differently exposed ranges. Proportional entry/exit refers to that range's current attributed basket, not automatically equal dollar deposits. Fee collection cannot withdraw principal. Deposits cannot claim pre-existing fees. The fixed fee's value and allocation among participating ticks must be specified before fee code; boundary status alone does not imply zero participation.

Range identity uses lambda, not radius or absolute k. The reference reports an exact rational k/r for supplied finite decimals. Approximate equality must not merge ranges. The future on-chain range grid/encoding needs its own derivation; reference Decimal rounding is not the grid.

## Failure policy and unresolved obligations

Reject invalid dimensions, nonfinite/negative quantities, unsupported decimals, invalid ranges, invalid sphere states, singular rates and overflow. The geometry reference rejects out-of-bound k rather than silently clamping inputs. Later trade execution must reject insufficient real inventory, invalid solution branches, convergence/crossing limits, unsupported pairs, unauthorized callbacks, stale deadlines and inadequate minimum outputs.

The following are deliberately unresolved, and block the corresponding implementation claims:

- Torus consolidation, branch selection, crossing/recovery and all-boundary trading.
- Per-tick reserve attribution during trades and LP entry/exit at boundaries. No automatic pool-wide withdrawal lock is adopted.
- Fee rate, segment allocation, fee/dust reconciliation and any pause authority/withdrawal policy.
- Fixed-point geometry format, supported radius/range grid, numeric tolerances and gas/iteration limits.
- Deployment-specific v4 dependency revisions and settlement adapter details.

The sphere reference is not a swap engine, LP accountant or proof of depeg protection. Those components must satisfy the conservation requirements separately.
