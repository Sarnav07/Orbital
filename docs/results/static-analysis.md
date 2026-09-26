# Static analysis

- **Tool:** Slither 0.11.6 (102 detectors), first run on 2026-09-25 against `contracts/src`. It was re-run on 2026-09-26 against the audited source that is now deployed ([AUDIT.md](../AUDIT.md)).
- **Result:** 55 results both times. One true positive (SA-1) was found, and the tool mislabeled it. It was graded **Low** (fail-closed, unreachable within the protocol's bounds) and is now **fixed**. The `incorrect-exp` line it pointed at stays in the output as a false positive.
- **High/Medium:** no true positive. Slither did not flag the High engine bug the manual review found (audit finding C-1, a crossing-detection logic error). A static analyzer cannot see it, which is why the review also used proof-of-concept tests.

```sh
cd contracts
slither . --filter-paths "lib/|test/|script/" --exclude-dependencies
```

| Impact (Slither) | Detector | Count | Verdict |
| --- | --- | ---: | --- |
| High | `incorrect-exp` | 1 | False positive on the flagged operator, but it exposed a real **Low** issue in the same branch. See SA-1. |
| High | `array-by-reference` | 1 | False positive. See SA-2. |
| Medium | `divide-before-multiply` | 7 | False positive: the standard 512-bit `mulDiv` inverse (SA-1 context). |
| Medium | `uninitialized-local` | 19 | False positive: counters and accumulators rely on Solidity zero-initialization. |
| Medium | `unused-return` | 3 | Accepted. See SA-3. |
| Low | `calls-loop` | 9 | Accepted: bounded loops (4 assets, ≤16 ranges) calling only the trusted PoolManager, the hook-owned fee book and the four registered tokens. |
| Low | `reentrancy-events` / `reentrancy-benign` | 6 | Accepted. See SA-4. |
| Low | `timestamp` | 1 | Accepted: user-chosen swap/liquidity deadlines. Validator skew of seconds is irrelevant at that granularity. |
| Info / Optimization | `assembly`, `low-level-calls`, `cyclomatic-complexity`, `cache-array-length` | 8 | Noted; no change. |

## SA-1 · `FixedPointMath.mulDivDown` wide-product branch reverts (Low, true positive, fixed)

**Where:** `contracts/src/math/FixedPointMath.sol:44-54`.

**Problem:** when `x * y ≥ 2^256`, the function takes the 512-bit branch. That branch computes the modular inverse with `3 * denominator` and returns `productLow * inverse`. Both are meant to wrap modulo 2^256, as in Uniswap's `FullMath`, where they sit inside `unchecked`. Here they are checked, so the branch reverts with `Panic(0x11)` instead of returning the correct result. Slither flagged the `^` on that line as a mistaken exponent. That part is a false positive: the XOR is the correct Newton seed. It led to the real defect beside it.

**Evidence** (`contracts/test/FixedPointMath.t.sol`):
- `testFuzzMatchesFullMathWhenProductFitsIn256Bits`: results equal `FullMath.mulDiv` exactly whenever `x * y < 2^256`.
- `testKnownIssueWideProductBranchRevertsInsteadOfWrapping`: characterizes the revert.

**Why Low:**
- **It fails closed.** A call either reverts or returns the correct value. It never returns a wrong amount, and no funds move on the failing path.
- **It is unreachable within the protocol's bounds.**
  - Engine values are capped at `1e29` WAD, so geometric products stay below about `1e59`.
  - Hook swap amounts are capped at `int128.max`.
  - Liquidity scaling multiplies a radius of at most `1e29` by a share count. Reaching `2^256` would need more than `1e48` shares, a deposit the pool would reject anyway.
  - Fee growth uses Q128 per share with radius-weighted allocation. The checkpoint product stays below `2^256` unless cumulative fees in one asset exceed about `3e38` raw units. With engine-bounded swap sizes, that would take on the order of `1e13` swaps.

**Fixed (2026-09-26, audit finding C-2):** the wide branch, from the `twos` computation through the return, now sits in `unchecked`, matching `FullMath`. The former known-issue test is replaced by `testWideProductBranchMatchesFullMath` and `testFuzzWideProductsMatchFullMath`, which assert equality with `FullMath` for products of at least 2^256. Both reverted with `Panic(0x11)` before the fix. The fixed library is part of the redeployed hooks.

## SA-2 · `array-by-reference` in `beforeSwap` (false positive)

`beforeSwap` passes the storage array `_reserves` to `SegmentedTorus4.swapExactIn`, which takes `uint256[4] memory`. Slither warns that the callee's changes will not persist. The hook never relies on them persisting: it stores `result.reserves` returned by the engine (`OrbitalV4Hook.sol`, `_reserves = result.reserves`). Parity tests assert that the stored reserves equal the engine output exactly.

## SA-3 · Unused return values (accepted)

- `poolManager.unlock(...)`: the hook's own callback returns empty bytes, so there is nothing to consume.
- `poolManager.settle()`: this returns the amount credited. The hook immediately mints exactly `amountIn` claims. If a token delivered less (fee-on-transfer), the hook's delta would stay negative and the whole `unlock` would revert with `CurrencyNotSettled`. Unsupported tokens therefore fail closed rather than being mis-accounted. Such tokens are outside the specification's domain.
- `TokenUnits.scale(decimals)` in the constructor is called only for its validation revert.

## SA-4 · Events after external calls (accepted)

`seed`, `addLiquidity`, `removeLiquidity`, `collectFees` and `beforeSwap` emit their event after calling the PoolManager and the fee book. The hook's own state changes happen before the PoolManager calls. The one exception is `collectFees`: it lowers `_feeLiability` after `feeBook.collect` returns the amounts, because only the fee book knows them. The fee book is created by the hook and calls nothing else. There is no reentrancy guard; safety rests on this ordering and on the PoolManager lock.

A reentrant call cannot exploit the ordering:
- The external calls go to the PoolManager (trusted), the hook-owned fee book, and the four registered mock tokens.
- A nested `unlock` while one is already open reverts in the PoolManager (`AlreadyUnlocked`).

## Not covered

This is automated static analysis. The manual review, its proof-of-concept tests and fixes are in [AUDIT.md](../AUDIT.md).
- Economic properties are exercised by tests, not proven: LP fairness across ranges, the depeg behaviour of fee policy, and JIT liquidity.
- Numerical-solver error bounds are likewise exercised by tests but not proven.
