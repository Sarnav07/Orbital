# Geometry reference

Run from the repository root with Python **3.14.6** (standard library only):

```sh
python3 -m unittest discover -s reference/tests -v
```

This is an independently authored Decimal model derived from sphere/plane projections, not a port of a Solidity implementation. It implements equal-price reserves, sphere residuals, polar decomposition, marginal rates, tick bounds, virtual reserves and capital efficiency. It does not yet implement torus consolidation, swaps, LP accounting or fees.

```python
from reference.orbital import Geometry

model = Geometry(n=4, radius="1000000", precision=80)
k = model.k_from_single_depeg("0.99")
tick = model.tick(k)
print(tick.real_reserve_at_peg, tick.capital_efficiency)
```

Inputs use decimal token amounts, not WAD integers. Use strings, integers or Decimal values; floats and nonfinite values are rejected. A fresh Decimal context isolates every calculation from caller rounding and precision. Decimal exponent limits still apply: arbitrary precision is not unbounded representability.

`k` is `sum(x)/sqrt(n)`, not `sum(x)`. Bounds are evaluated at the configured precision; reuse `k_bounds()` for analytical endpoints. A zero-width tick has no real deposit and reports efficiency `None`. It is an analytical limit, not a permitted LP position. A near-degenerate input that cannot be resolved raises an error rather than promising infinite efficiency. Increase precision and rerun.

`normalized_boundary` is an exact Fraction of the supplied k and radius. Scaling exact inputs preserves identity; it is not an on-chain range grid or a fuzzy equality check. Irrational endpoints represented at different precisions need not have identical rational identities.

Tests include hand-derived Pythagorean states, endpoint checks, radius scaling, permutation symmetry, a separately expressed quadratic cross-check, finite-difference price orientation and precision convergence. Their tolerances are reference-only. They are not evidence of Solidity quote parity, solvency or protection against depegs.

See [the mathematical specification](../docs/SPECIFICATION.md) for equations, derivation and unresolved protocol obligations.
