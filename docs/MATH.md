# Mathematical contract

This file is the normative mathematical reference for the Orbital hook. [PAPER_IMPLEMENTATION.md](PAPER_IMPLEMENTATION.md) traces each item to code and evidence, and [TESTS.md](TESTS.md) lists the cases that accept it.

- **Source:** the mathematical source is [Paradigm's Orbital paper](https://www.paradigm.xyz/writing/orbital), in particular Sphere AMM, Tick Boundary Geometry, Tick Reserve Bounds and Capital Efficiency. The equations below are restated and derived for this implementation; no reference-implementation code is copied.
- **Units:** equations use real, normalized token amounts unless a requirement explicitly describes the WAD integer form.
- **Numbers:** the Solidity prototype fixes `n = 4`, so `sqrt(n) = 2` exactly in WAD.

## 1. Per-tick geometry and canonical coordinates

| Symbol | Meaning |
| --- | --- |
| `n` | Asset count. The reference supports integer `n ≥ 2`; the deployed hook fixes `n = 4`. |
| `r` | Positive sphere radius, in normalized token units. |
| `x_i` | Mathematical reserve coordinate, including the virtual offset. |
| `v` | Unit diagonal `(1,…,1)/sqrt(n)`. |
| `α` | `dot(x, v) = Σ x_i / sqrt(n)`. |
| `k` | Tick boundary projection: the plane `α = k`. |
| `λ` | Dimensionless range identity `k/r`, independent of liquidity size. |
| `s` | Radius of the sphere/plane intersection in the orthogonal subspace. |
| `x_min` | Per-token virtual offset: the tick's minimum mathematical reserve. |
| `a_i` | Real tradable inventory attributed to a tick: `x_i − x_min`. |

`MATH-1` The nonnegative-price sphere branch satisfies `0 ≤ x_i ≤ r` and

```text
Σ (r − x_i)² = r²
q = r (1 − 1/sqrt(n))                          # equal reserve per asset
output_j / input_i (infinitesimal) = (r − x_i) / (r − x_j)
```

This rate is output token `j` per input token `i`, before fees. Its inverse is a different quote. A zero denominator is singular and is rejected.

`MATH-2` A tick is the cap containing `q` with `α ≤ k`, not a disjoint Uniswap price interval. `k` is **not** `Σ x_i`: on the boundary that sum is `k·sqrt(n)`. Valid boundaries satisfy

```text
k_min = r (sqrt(n) − 1)        k_max = r (n − 1) / sqrt(n)
```

`MATH-3` Intersecting the sphere with `α = k` gives a center of `k·v` in reserve coordinates and

```text
s²   = r² − (k − r·sqrt(n))²   = (k − k_min)(2r − (k − k_min))
m    = k / sqrt(n)
d    = sqrt((n−1)/n) · s
x_min = m − d                  = (k_max − k)² / (m + d)
x_max = min(r, m + d)
real reserve at peg = q − x_min
capital efficiency at peg = q / (q − x_min)
```

**Derivation.** Write `x = k·v + w` with `Σ w = 0` and `‖w‖ = s`. A coordinate axis projects into that subspace with norm `sqrt((n−1)/n)`, which gives the extrema above. The factorized forms avoid cancellation, and `x_min = (k_max − k)²/(m + d)` follows from `m² − d² = (k_max − k)²`. The maximum is clipped to the nonnegative-price branch; when clipping occurs, setting all other coordinates equal no longer describes a boundary point.

`MATH-4` Endpoints:
- **At `k_min`:** `s = 0`, `x_min = x_max = q`, and the real deposit is 0. Efficiency is undefined, not infinite, and creating such a range is rejected.
- **At `k_max`:** `x_min = 0` and efficiency is 1.
- **Scaling:** scaling `r` and `k` together preserves `λ` and the concentration.

`MATH-5` **Four-asset fixed-point form** (`Sphere4`):
- **Radius domain:** the radius is positive, even in WAD, and at most `1e29`. These are arithmetic-domain limits, not liquidity limits.
- **Constants:** `q = r/2`, `k_min = r`, `k_max = 3r/2`, and `s² = (k−r)(3r−k)`.
- **Rounding:** square roots are floored WAD, and the `sqrt(3)` coefficient is a floored WAD constant. Every derived value is therefore directionally rounded down, and it differs from the Decimal reference by a bounded amount.

## 2. Consolidation and the aggregate torus

`MATH-6` For a fixed interior/boundary partition, let `r_int` be the sum of interior radii, `k_bound` the sum of boundary `k`, and `s_bound` the sum of boundary radii `s`. For total reserves `x`, let `α_total = Σ x_i / sqrt(n)` and `‖w‖ = sqrt(Σ (x_i − mean(x))²)`. Then

```text
(α_total − k_bound − r_int·sqrt(n))² + (‖w‖ − s_bound)² = r_int²
```

Interior radii add by similarity, and boundary transverse radii add linearly. `Torus4` evaluates this residual for `n = 4` and accepts a state when `|residual| / r_int² ≤ 1e-9`. That bound is solver-domain policy, not a claim about economic error.

## 3. Tick partition and crossing

`MATH-7` All interior ticks share one normalized reserve direction. A tick stays interior exactly while `α_int / r_int < k/r`, where `α_int = α_total − k_bound`.
- **Rising `α_int / r_int`:** traps the smallest crossed interior `k/r`.
- **Falling `α_int / r_int`:** recovers the largest crossed boundary `k/r`.

Ranges with exactly the same `k/r` flip together. Range identity is `λ`, never radius or absolute `k`.

`MATH-8` At a crossover to `λ`, the total reserve sum is fixed at `(r_int·λ + k_bound)·sqrt(n)`, which is `2(r_int·λ + k_bound)` for `n = 4`. That fixes `input − output`, so the crossover reduces to one scalar physical root, which is bracketed and bisected.

`MATH-9` For a single-depeg scenario, where one price `p` is set against otherwise equal prices,

```text
k(p)/r = sqrt(n) − (p + n − 1) / sqrt(n (p² + n − 1)),   0 ≤ p ≤ 1
```

This is a scenario-specific interpretation, not a universal multi-asset price floor. For the deployed ranges:
- `k/r = 1.001` traps near `p ≈ 0.90`.
- `k/r = 1.004` traps near `p ≈ 0.80`.
- `k/r = 1.05` traps near `p ≈ 0.36`.

## 4. Reconstructing range liquidity

`MATH-10` `RangeLiquidity4.attribute` derives each range's coordinate from the aggregate reserve vector and its recorded status. The shared transverse spread is `‖w‖`, and `‖w_int‖ = ‖w‖ − s_bound` is the interior part.

| Range state | `α` share | Transverse share |
| --- | --- | --- |
| Interior | `α_int · r_i / r_int` | `‖w_int‖ · r_i / r_int` |
| Boundary | `k_i` | `s_i` |

Per asset, the coordinate is `α share / 2 ± |x_i − mean| · (transverse share / ‖w‖)`. The virtual offset is the tick's `x_min`, and the redeemable inventory is `coordinate − x_min`. Directional allocation floors, so a few WAD-wei of attribution dust are never assigned to an LP. Virtual offsets are never redeemable. The derivation holds in both interior and boundary states; one trapped range does not freeze withdrawals elsewhere.

## 5. Fixed-partition exact-input solve

`MATH-11` `Torus4.quoteExactIn` keeps the partition fixed:
1. Scan 48 output intervals over `[0, reserve_out − 1]`.
2. Bisect the first sign-changing residual bracket for at most 96 iterations.
3. Choose the endpoint with the smaller absolute residual.
4. Reject any candidate that fails `MATH-6`'s acceptance bound.

It mutates no state and never discovers a crossing. A fixed-partition quote must not be settled if its partition changed.

## 6. Complete swap traversal

`MATH-12` `SegmentedTorus4.swapExactIn` handles a whole swap:
- **Setup:** receives ≤ 16 ranges, rebuilds the aggregate, and rejects a mismatch.
- **Each segment:** quotes the remainder under `MATH-11`. If `α_int / r_int` crosses a boundary (`MATH-7`), it solves only to that boundary (`MATH-8`), applies the partial trade, flips the tied ranges, rebuilds `r_int`, `k_bound` and `s_bound`, and continues.
- **Crossing limit:** at most 8 status transitions per swap.
- **Reported values:** the bitmap and crossing count come from the actual transition sequence.
- **All-boundary:** continuing when every range would be at its boundary reverts the whole swap. There is no partial settlement.

## 7. Fees, decimals and rounding

`MATH-13` Raw token amounts convert to WAD by multiplying by `10^(18 − decimals)` exactly, with overflow rejection (`TokenUnits`). Required inputs round up and payouts round down.

`MATH-14` In `beforeSwap`:

```text
fee        = ceil(amountIn_raw × fee_pips / 1,000,000)      # rejected if ≥ amountIn
net_wad    = (amountIn_raw − fee) × 10^(18 − d_in)
out_raw    = floor(SegmentedTorus4(net_wad) / 10^(18 − d_out))
minimum    = floor(quote × (10,000 − slippage_bps) / 10,000)   # app-side
```

The unpaid WAD remainder of the output stays in custody as non-redeemable dust.

`MATH-15` The fee is split across the ranges that were interior when the swap started, weighted by radius. Per-share growth is Q128.
- **Rounding remainders:** the allocation remainder and the per-share remainder are both tracked as per-asset dust.
- **Checkpoints:** mints and burns checkpoint first, so new shares cannot claim earlier fees.

`MATH-16` Liquidity changes scale one range's `(r, k)` by the share ratio with `k/r` fixed, and move its attributed coordinate by the same ratio.
- **Additions:** round the radius up to an even WAD value, and round coordinates up.
- **Removals:** round both down.

The user pays or receives the change in `ceil((reserve_i − Σ x_min) / 10^(18 − d_i))`, so custody minus requirement never decreases.

`MATH-17` Solvency at every settled boundary:

```text
claims_i ≥ ceil((reserve_i − Σ_ranges x_min) / 10^(18 − d_i)) + unpaid_fees_i
```

## 8. Paper-to-implementation notes

| Paper notion | Resolution here |
| --- | --- |
| Tick as price interval | A tick is a spherical cap `α ≤ k` containing the equal-price point, and range identity is `k/r` (`MATH-2`, `MATH-7`). |
| Boundary sum vs projection | `k` is the projection; the boundary reserve sum is `k·sqrt(n)` (`MATH-2`). |
| Virtual reserve near `k_max` | Use `(k_max − k)²/(m + d)` to keep tiny offsets exact (`MATH-3`). |
| Consolidated boundary radius | Sum each tick's transverse radius `s` (`MATH-6`). |
| Crossover solve | The fixed reserve sum at the boundary reduces it to one scalar root (`MATH-8`). |
| Depeg threshold | A single-depeg scenario only, not a universal floor (`MATH-9`). |
| All-boundary regime | Not implemented; reverts (`MATH-12`). |

## 9. Independent reference model and parity obligations

`MATH-18` The Decimal Python reference (`reference/orbital`) accepts Decimal, integer or decimal-string inputs, rejects floats and non-finite values, and controls its own precision. A reference tolerance is not a Solidity error budget. It matches the Solidity crossing fixture to 18 decimals (`40.123552802932248591…`).

`MATH-19` The Solidity engine, settlement through a real PoolManager, and the browser BigInt engine (`packages/simulator`) must agree **to the wei** on `packages/fixtures/quote-vectors-v1.json`. That covers outputs, reserves, status bitmaps and per-range attribution. The app's `quoteHookSwap` must reproduce `MATH-14` exactly, and it matches the recorded testnet swap (`999433404420670936920` DAI wei).
