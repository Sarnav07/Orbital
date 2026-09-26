# Orbital security review

Internal, line-by-line review of the Orbital repository before submission, done in the role of a security auditor. **This is not a professional third-party audit.** Findings were proven with tests where possible, fixed test-first, and the fixed hook was redeployed on all four testnets.

- **Date:** 2026-09-26/27
- **Baseline:** `main` at `014e580`, plus the uncommitted app changes present at the start of the review
- **Result:** 1 High, 4 Medium, 9 Low and a set of informational notes. All High, Medium and Low findings are **fixed**.

## 1. Verdict

| Question | Answer |
| --- | --- |
| Is the on-chain code safe to demo? | **Yes, after the fixes.** The one serious bug (C-1) is fixed, proven by tests and deployed. Solvency held throughout, before and after. |
| Does everything the docs claim actually work? | **Now, yes.** The app, contracts, scripts and docs agree. Test counts, addresses, verification status and feature claims were all corrected. |
| Does CI pass? | **Locally, yes, from a clean checkout.** CI on GitHub has been red since `9073ca9` because of CI-1. The fix is in the working tree; GitHub can only confirm it after a push. |
| Ready to submit? | **Yes, once the changes are pushed.** See the [checklist](#10-submission-readiness). The live site still serves the previous build, which points at the superseded hooks, until the push triggers a Vercel deploy. |

## 2. Scope and method

**In scope (every line was read):**
- `contracts/src` (9 files), `contracts/script` (4) and `contracts/test` (17);
- `packages/simulator` (quote and replay engine, vectors) and `reference/` (Python model);
- `app/src` (chain layer, `/app` shell, landing, docs, sandbox), `app/index.html`, `vercel.json`;
- `.github/workflows`, `Makefile`, `scripts/app-e2e.sh`;
- all of `docs/` and `README.md`.

**Method:**
1. **Manual review** of the hook, the four math libraries, the fee book, the deploy scripts and the app's transaction path, against the v4-core sources (`PoolManager`, `Hooks`, `PoolSwapTest`).
2. **A proof-of-concept test for every suspected contract bug before any fix**, run against the unfixed code to confirm it fails.
3. **Fuzzing and invariants:** the CI profile (4,096 fuzz runs, 96×20 invariant campaigns) on the fixed code.
4. **Static analysis:** Slither 0.11.6 re-run on the fixed source (`docs/results/static-analysis.md`), plus `forge lint`.
5. **Clean-checkout reproduction** of CI's `app-e2e` job in a fresh `git worktree`.
6. **Cross-checks** of every numeric claim, address and test count in the docs against code, manifests and broadcasts.
7. **Live checks after the redeploy:**
   - a guarded smoke swap on each network;
   - `seeded()` and `solvency()` read back;
   - the read-only live suite (`ORBITAL_LIVE=1`, 8/8);
   - source verification.

**Out of scope:** economic and game-theoretic analysis beyond what is noted; formal verification of the numerical solver's error bounds; the pinned `v4-core`, `forge-std` and `solmate` dependencies; the wallets themselves.

**Severity scale:**

| Severity | Meaning |
| --- | --- |
| High | Loss or freezing of funds, or a broken core invariant, reachable by an ordinary user |
| Medium | Wrong behaviour or weakened protection with bounded impact, or a false public claim |
| Low | Defence in depth, fail-closed defects, UX issues that can mislead |
| Info | Design limits, documented and accepted |

## 3. Findings summary

| ID | Severity | Title | Status |
| --- | --- | --- | --- |
| C-1 | **High** | A trade ending exactly on a range's plane leaves the range's status stale: it trades past its bound, or sits out inside its band, and LP withdrawals freeze | Fixed, redeployed |
| CI-1 | Medium | CI `app-e2e` has failed on every run since it was added: a fresh checkout has no PoolManager artifact | Fixed |
| A-1 | Medium | Switching networks while a read is in flight writes the old network's book into the new view (wrong decimals and token order in quotes and `minOut`) | Fixed |
| A-3 | Medium | A receipt timeout (180 s) marks a still-pending swap as failed and offers "Try again", so a user can swap twice | Fixed |
| D-1 | Medium | Documentation drift: wrong test counts, contradictory verification claims, a "queued" fix that never shipped, a false hook-address claim | Fixed |
| C-2 | Low | `FixedPointMath.mulDivDown`: the 512-bit branch reverts instead of wrapping (SA-1) | Fixed, redeployed |
| C-3 | Low | A fee with no range in range reverts the whole swap (`RangeFeeBook4.accrue` rejects an empty set) | Fixed, redeployed |
| A-2 | Low | **Max** loses precision above 2^53 raw units, can exceed the balance, or produce `"1e-18"` | Fixed |
| A-4 | Low | Unlimited (`2^256−1`) approvals to the test router and the hook; UI copy misdescribed them | Fixed |
| A-5 | Low | Stale balances after an account switch; `busy` leaks across networks; toasts link to the wrong explorer after a switch | Fixed |
| A-6 | Low | 30 hook/router errors unexplained; `require` reasons and panic codes discarded | Fixed |
| A-7 | Low | Liquidity limits can be sized from the preview of a previous amount | Fixed |
| A-8 | Low | The swap page ignores pool-read failures; the swap-history catch-up is unbounded | Fixed |
| A-9 | Low | No security headers on the deployed site (clickjacking of a transaction-sending dApp) | Fixed |

## 4. Contract findings

### C-1 · High · Stale range status after a trade ends exactly on a boundary plane

**Where:** `SegmentedTorus4.swapExactIn` / `_nextCrossing` (`contracts/src/math/SegmentedTorus4.sol`). The same logic is mirrored in `packages/simulator/src/quote.js` and `reference/orbital/segmented.py`.

**Problem.** Each range is interior while the book's normalised projection α is below its plane λ = k/r, and boundary above it.
- **Crossing detection** uses strict inequalities: a rising trade looks for interior ranges with `λ > α_before`, a falling trade for boundary ranges with `λ < α_before`.
- **After an exact landing** (the `alphaAfter == lambda` branch), the range flips. α is then re-normalised under the new partition and comes out as λ, or λ ± 1 through rounding.
- **What the next trade misses:** a trade moving away from the plane never sees that range again, because its λ is no longer strictly beyond α_before.

**Impact (proven):**
- **Falling side:** the range stays *boundary* while the book is back inside its band. Its LPs earn no fees, and traders get worse prices.
- **Rising side:** the range stays *interior* while the book moves past its bound.
  - The range keeps providing liquidity beyond the limit its LPs chose, so other ranges' inventory subsidises it.
  - Its real inventory goes negative, so `RangeLiquidity4.attribute` reverts with `NegativeRealInventory`.
  - Every `addLiquidity`, `removeLiquidity` and `rangeAttributions()` on **every** range then reverts, freezing LP withdrawals until someone trades back.
- **Aggregate solvency still held:** custody versus requirement is derived from aggregate reserves, and the invariant campaigns never failed.

**Reachability:** any trader. With an 18-decimal input (DAI or FRAX), 1-wei input granularity makes landing exactly on a plane easy to target. On testnet the tokens are free to mint.

**Proof of concept:**
- `contracts/test/BoundaryStatus.t.sol` (engine, three tests plus a fuzz test);
- `contracts/test/OrbitalV4HookBoundary.t.sol` (through a real PoolManager and router).

All of them failed on the unfixed engine, for example:
- `boundary range is back inside its band: 1000996621862434117 < 1001000000000000000`
- `NegativeRealInventory()`

**Fix:** `_flipSettled`. Before looking for a crossing, a range already at (or by rounding past) its plane in the direction of travel flips first, with no trade. The engine then re-aggregates, re-checks the invariant and continues. The same rule was added to the BigInt and Python mirrors. The shared parity vectors are byte-identical before and after, so no recorded quote changed.

**Cost:** about 3,000 gas per ordinary swap (`docs/results/gas-baseline.md`).

### C-2 · Low · `mulDivDown` wide-product branch reverts (formerly SA-1)

**Where:** `contracts/src/math/FixedPointMath.sol`.

**Problem:** the 512-bit path ran in checked arithmetic, so `0 − denominator`, `3 * denominator` and the Newton steps reverted with `Panic(0x11)` instead of wrapping.
- **Severity:** it fails closed and is unreachable within protocol bounds, so Low.
- **History:** it had been documented as "fix queued for the next deployment", but three later deployments shipped without it.

**Fix:** the branch now runs in `unchecked`, as in `FullMath`.

**Tests:** `testWideProductBranchMatchesFullMath` and `testFuzzWideProductsMatchFullMath` assert equality with `FullMath` for products of at least 2^256. Both reverted before the fix.

### C-3 · Low · Fee accrual with no in-range range reverts the swap

**Where:** `OrbitalV4Hook._accrueFee` → `RangeFeeBook4.accrue`, which reverts `InvalidWeights` on an empty set.

**Problem:** the engine currently refuses to trade from an all-boundary book, so this is not reachable today. But the hook depended on that for liveness.

**Fix:** with no range in range, the fee stays in custody as unowed dust. It is not added to the fee liability, because nobody could collect it.

**Test:** `test/OrbitalV4HookFeeAccrual.t.sol`, using a harness. It reverted with `InvalidWeights()` before the fix.

### Verified correct (no change needed)
- **Access control:**
  - every v4 callback is `onlyPoolManager`;
  - `unlockCallback` can only be reached through the hook's own `unlock`, because the PoolManager calls back `msg.sender`;
  - `seed` is owner-only and one-time;
  - the fee book is controller-only;
  - there are no admin setters, so nothing can drain or pause.
- **Pool admission:** `beforeInitialize` admits only the six canonical keys (sorted currencies, fee 500, spacing 60, this hook); native liquidity is rejected.
- **Swap path:**
  - exact-input only, including rejection of `int256.min`;
  - input capped at `int128.max`;
  - `BeforeSwapDelta(+in, −out)` signs are correct and core `amountToSwap` is 0;
  - input is minted as claims, output claims burned;
  - `hookData` `minAmountOut` and deadline are enforced on-chain.
- **Rounding:**
  - the fee rounds up;
  - input converts to WAD exactly, output rounds down;
  - solvency follows from `ceil(a) − floor(b) ≥ ceil(a − b)`, and the invariant campaigns confirm it.
- **Liquidity:** additions round up and removals round down (pool-favoured); `MIN_LOCKED_SHARES` prevents emptying a range; `maxAmountsIn`, `minAmountsOut` and deadlines are enforced.
- **Fee book:** checkpoints prevent claims on earlier fees; the Q128 growth arithmetic stays in range; the sum of payouts never exceeds the liability.
- **Reentrancy:** checks-effects-interactions holds for the PoolManager calls; a nested `unlock` reverts; fee-on-transfer tokens fail closed with `CurrencyNotSettled`.
- **Secrets:** none in the tree or anywhere in git history. Only anvil's public development keys appear; `.env` and `.env.local` are ignored.

## 5. CI finding

### CI-1 · Medium · `app-e2e` never passed on GitHub

**Evidence:** Actions runs for `9073ca9`, `1a99b99` and `014e580` all failed, with only the `app-e2e` job red. Reproduced in a fresh worktree: `vm.getCode: no matching artifact found`.

**Cause:** `forge script` compiles only the script's own imports. `DeployOrbitalDemo` deploys the PoolManager with `deployCode`, whose artifact comes from `test/utils/V4Artifacts.sol`. Local runs passed only because `out/` was already warm.

**Fix:** `scripts/app-e2e.sh` runs `forge build` first. From a clean worktree it now deploys and passes 4/4. The workflow's actions were also bumped off the deprecated Node 20 runtime (`checkout@v5`, `setup-node@v5`, `setup-python@v6`).

## 6. App findings

| ID | Where | Fix | Test |
| --- | --- | --- | --- |
| A-1 | `uni/state.tsx` refresh | Reads started for a superseded network or account are dropped. Refreshes are serialised (overlapping polls duplicated swaps). The catch-up scan is capped at 50,000 blocks. | `Audit regressions › A-1`; `uni/state.test.ts` |
| A-2 | `uni/SwapPage.tsx` Max | `formatUnits(balance, decimals)` | `A-2` |
| A-3 | `uni/services.ts`, `state.tsx`, review modal | A 10-minute receipt wait. A timeout is reported as **still pending**, never as failed, with no retry offered, and the receipt keeps being watched in the background. | `A-3` |
| A-4 | `chain/actions.ts`, swap and pool pages, deploy scripts | Approvals are exact: the swap amount, or each coin's `maxIn`. The builder no longer has an unlimited default. The copy is corrected. | `A-4`; e2e updated |
| A-5 | `uni/state.tsx`, toasts | `accountState` is cleared on an account change. Toasts carry their network and explorer link, and `busy` is per network. | `A-5` (two tests) |
| A-6 | `chain/errors.ts`, `abi.ts` | Every hook, fee-book and router error is explained in plain words. `Error(string)` reasons and panic codes are shown. | `chain/errors.test.ts` |
| A-7 | `uni/PoolPage.tsx` | A preview is keyed to the exact range and share amount; the action stays disabled until it matches. | `A-7` |
| A-8 | `uni/SwapPage.tsx` | A banner when the pool can't be read: stale quotes are labelled, and no quote is offered without data. | `A-8` |
| A-9 | `vercel.json` | `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'` (plus `base-uri`, `object-src`, `form-action`), `nosniff`, `Referrer-Policy`, `Permissions-Policy` | Config |

**Also fixed (UI, not security):** the `/app` nav was transparent while sticky, so page content showed through it when scrolled. It now has a translucent, blurred surface.

**Verified correct:**
- the swap `PoolKey` and direction;
- exact-input encoding;
- `hookData` carries `(minAmountOut, deadline)`;
- the quote is an exact mirror of `beforeSwap`, reproduced to the wei on-chain on all four networks;
- the slippage bps math;
- a wrong-chain send is blocked (viem asserts the chain);
- there are no keys in the bundle.

## 7. Documentation findings (D-1, Medium)

| Claim | Was | Now |
| --- | --- | --- |
| App test count (SUBMISSION, RELEASE, REMAINING_WORK) | "59" | 102; the other counts are also refreshed: Solidity 74, Python 32, simulator 13, E2E 4 |
| Source verification | DocsPage "Every contract has published source" contradicted the README and RELEASE ("not yet verified") | All 8 new contracts verified: Blockscout (Unichain), exact Sourcify matches (the other three) |
| SA-1 | "Fix queued for the next deployment", but three deployments shipped without it | Fixed and deployed (C-2) |
| Hook address | "ends in `0x…2888`" (only Unichain's did) | The low 14 bits are `0x2888`, the permission flags |
| Solvency | "A fuzzed invariant enforces this" | A view, checked by tests; solvency follows from the rounding rules |
| Unichain-only wording | README, SUBMISSION, DEMO_SCRIPT, ADR, DocsPage, meta description, cover image, landing | Four testnets |
| QA step B2.4 | expected "Insufficient liquidity" | "Insufficient USDC balance" (the balance is checked first) |
| MATH-12 | "at most 8 status transitions" | 8 crossing segments; tied ranges can flip more |
| ADR-0001 | "landing page does not load viem" | viem's chain table is in the landing bundle (via docs); the wallet flow is code-split |
| `forge lint` | "no warnings" (not run anywhere) | Run: 0 warnings after fixing 2 new ones; noted as a manual gate |
| Arc explorer | `testnet.arcscan.app` | It 301-redirects; the app and docs now use `explorer.testnet.arc.io` |

## 8. Redeployment

The hook was replaced on all four networks with `contracts/script/RedeployOrbitalHook.s.sol` (new; tested in `testRedeployScriptReusesTokensAndRouterAndSeedsANewHook`).
- **What stayed:** the mock tokens, routers and PoolManagers, so token addresses in wallets stay valid.
- **The old hooks:** they remain on-chain but unused, recorded under `supersedes` in each manifest.

| Network | New hook | Old hook | Smoke swap (1,000 USDC → DAI, guarded) |
| --- | --- | --- | --- |
| Unichain Sepolia | `0x5fe242b3544Dd0d30C395843dE75A2B8d4dBA888` | `0x10f107C2…B2888` | 999.433404420670936920 DAI · `0x59f6dfa9…` |
| Ethereum Sepolia | `0x1140236A2d35b328f38F9eF8Bee3C781F0fA6888` | `0xd5892e1A…eA888` | 999.433404420670936920 DAI · `0xc6cecb15…` |
| Arbitrum Sepolia | `0x39Fb6DC7EF95c33FBDa2c8B2ED90f8E069736888` | `0x7E7a96FD…fA888` | 999.433404420670936920 DAI · `0xb2fcf6df…` |
| Arc Testnet | `0xb2e429bC1E7184F717a1dfEEd34F72FCA130E888` | `0x9cd75cfa…16888` | 999.433404420670936920 DAI · `0xdb6a6c55…` |

- **Deploys:** every deploy was 16 transactions, all successful. `seeded()` is true and `solvency()` holds on every chain.
- **Live suite:** `ORBITAL_LIVE=1` read-only checks pass 8/8.
- **Verification:** every hook and fee book is source-verified (creation and runtime exact matches on Sourcify; verified on Blockscout for Unichain).
- **Details:** in [RELEASE.md](RELEASE.md#deployment-provenance) and `contracts/deployments/*.json`.

## 9. Residual risks and known limits (Info, accepted)

- **Demo-only infrastructure:**
  - the router is v4-core's `PoolSwapTest`, a test router;
  - the tokens are mocks with a public `mint`, so TVL and volume figures have no economic meaning;
  - anyone can move the book to extreme depegs for free.
- **Centralisation:**
  - the deployer holds about 100% of LP shares on every network;
  - that key also still holds an unlimited allowance to each network's router from the original demo deploy (its own funds only; revoke if desired);
  - there is no pause switch (by design, no admin powers).
- **Arc's PoolManager** is byte-identical to Uniswap's v4 PoolManager but has a different owner. Its owner can only enable protocol fees, which don't apply because the core pool never trades.
- **Engine limits:**
  - exact-input only;
  - at most 8 crossing segments;
  - a trade that would trap every range reverts;
  - `sqrtPriceLimitX96` is ignored, and `minAmountOut` in hookData is the price guard;
  - empty hookData means no slippage or deadline check (the app always sends it).
- **Fee policy:**
  - fees go to ranges in range at swap start, weighted by radius, including a range that traps mid-swap;
  - JIT liquidity can capture fees;
  - fees accrued to the locked minimum shares are permanently locked dust.
- **Numerics:** the torus solver's acceptance rule is a relative residual of 1e-9, tested but not formally bounded.
- **`collectFees` recipient:** any address is accepted, including `address(0)`; the app always pays the connected account.
- **Supersession:** the superseded hooks stay callable on-chain with the pre-audit engine. Only their deployer-seeded liquidity is exposed, and the app no longer points at them.

## 10. Submission readiness

| Item | Status |
| --- | --- |
| Contracts: C-1, C-2, C-3 fixed with tests that failed first | ✅ |
| Hooks redeployed, seeded, smoke-swapped and verified on all four networks | ✅ |
| `make check` (Foundry 74, Python 32, simulator 13, app 102 tests, typecheck, build) | ✅ |
| `FOUNDRY_PROFILE=ci` fuzz and invariant campaigns | ✅ |
| `make app-e2e` from a clean checkout | ✅ |
| Slither re-run (no High/Medium true positive), `forge fmt`, `forge lint` clean | ✅ |
| Live read-only suite against the new hooks | ✅ 8/8 |
| Docs match the code and the chain | ✅ |
| **Commit and push** so GitHub CI turns green and Vercel serves the new build (the live site currently points at the superseded hooks) | ⏳ you |
| Demo video, final commit SHA and team in `docs/SUBMISSION.md` | ⏳ you |
| Manual wallet QA on the deployed site (REMAINING_WORK B2) | ⏳ you |

**Verdict:** the code, contracts and deployments are ready for submission. Push the changes, confirm the GitHub Actions run is green and the Vercel deploy shows the new hook addresses, then finish the three items marked for you.
