# Tests-first acceptance specification

This file maps every acceptance case to the test that executes it. Requirement IDs (`MATH-n`) refer to [MATH.md](MATH.md); the mechanism-to-status ledger is [PAPER_IMPLEMENTATION.md](PAPER_IMPLEMENTATION.md).

## 1. Workflow and evidence

`TEST-1` **Order of work.** Behaviour changes start with a failing test that fails for the specified reason, not a compiler error. Then comes the smallest implementation that passes, then the whole suite. Characterization tests of existing behaviour are labeled as such.

`TEST-2` **Where expected values come from.** Expected values come from hand-derived cases, the independent Decimal reference, or externally computed integers. A second copy of the production solver is not a reference. The exception is the shared vector file, which exists to prove *parity* between independent implementations. It is regenerated only by `packages/simulator/scripts/generate-vectors.mjs` and checked in.

`TEST-3` **No network in the regular suite.** It never queries an RPC or regenerates expected outputs from the code under test. Live-network checks are opt-in and read-only.

`TEST-4` **Commands:**

| Command | Scope |
| --- | --- |
| `make check` | Forge format, build and sizes; Foundry suite; Python reference; simulator; app unit/render tests, typecheck and build. |
| `cd contracts && FOUNDRY_PROFILE=ci forge test` | Same Foundry suite with 4,096 fuzz runs and deeper invariant campaigns. |
| `make app-e2e` | Deploys the demo to a throwaway anvil node and drives it with the app's own transaction builders. |
| `ORBITAL_LIVE=1 npx vitest run src/chain/live.testnet.test.ts` (in `app/`) | Read-only checks against all four recorded deployments (Unichain Sepolia, Ethereum Sepolia, Arbitrum Sepolia, Arc Testnet). |

## 2. Mandatory deterministic suites

### A. Geometry (`MATH-1…5`, `MATH-9`)

| Case ID | Given / operation | Test |
| --- | --- | --- |
| `GEO-01` | Equal-price states for n = 2, 3, 4 | `test_equal_price_states_for_two_three_four_assets` (Python) |
| `GEO-02` | Hand-derived n = 2, 3, 4 ticks | `test_hand_derived_{two,three,four}_asset_tick` (Python); `testHandDerivedTick` (Solidity) |
| `GEO-03` | `k_min` analytical only; `k_max` has no virtual offset | `test_minimal_tick_is_analytical_only`, `test_maximal_tick_has_no_virtual_offset`; `testEndpoints` |
| `GEO-04` | Projection and Pythagoras, price direction and reciprocity | `test_projection_and_pythagoras`, `test_price_direction_and_reciprocity`; `testSphereAndPriceWitnesses`, `testFuzzRateReciprocity` |
| `GEO-05` | Permutation symmetry, scale invariance, exact range identity | `test_permutation_symmetry`, `test_scale_invariance_and_exact_range_identity`, `test_range_identity_does_not_fuzzily_merge_nearby_ticks`; `testScaleInvariance` |
| `GEO-06` | Concentration decreases as the tick widens | `test_concentration_decreases_as_tick_widens` |
| `GEO-07` | Single-depeg boundary matches the price vector; unresolvable depegs reject | `test_single_depeg_boundary_matches_price_vector`, `test_unresolvable_single_depeg_rejects_instead_of_collapsing` |
| `GEO-08` | Fixed-point square roots round down; bounded fuzz | `testFixedPointSquareRootsRoundDown`, `testFuzzSquareRootBounds`, `testFuzzBounds` |
| `GEO-09` | Precision convergence and near-endpoint finiteness | `test_precision_convergence`, `test_near_endpoints_remain_finite_and_in_domain`, `test_seeded_geometry_sweep` |
| `GEO-10` | Invalid inputs rejected, never clamped | `test_invalid_model_inputs`, `test_invalid_tick_and_depeg_inputs`, `test_invalid_states_and_price_indices`, `test_zero_and_singular_price`; `testRejectsInvalidInputs` |

### B. Swaps within a partition (`MATH-6`, `MATH-11`)

| Case ID | Scenario | Test |
| --- | --- | --- |
| `SW-01` | All-interior book behaves as one sphere of summed radius | `test_initial_state_is_consolidated_sphere`, `test_within_segment_trade_matches_sphere_witness`; `testInteriorSphereQuote` |
| `SW-02` | Boundary aggregate quote matches the Decimal fixture | `testBoundaryAggregateQuoteMatchesReferenceFixture` |
| `SW-03` | Fuzzed interior quotes keep the bounded invariant | `testFuzzInteriorQuotesPreserveBoundedInvariant` |
| `SW-04` | Invalid or unsupported quotes rejected | `testRejectsInvalidOrUnsupportedQuotes`; BigInt `rejects invalid and unsupported quote domains` |

### C. Crossing and recovery (`MATH-7`, `MATH-8`, `MATH-12`)

| Case ID | Scenario | Test |
| --- | --- | --- |
| `CROSS-01` | Trade traps the first range and continues | `test_trade_segments_at_first_boundary_and_updates_torus_state`; `testTrapsFirstRangeAndContinues` |
| `CROSS-02` | Trade inside the first segment changes no status | `testWithinFirstSegmentDoesNotChangeTickState` |
| `CROSS-03` | Reverse trade recovers the crossed range | `test_reverse_trade_recovers_boundary_before_continuing`; `testReverseTradeRecoversRange`; BigInt `a reverse trade recovers the crossed range` |
| `CROSS-04` | Tied `k/r` ranges cross together | `test_tied_ranges_cross_together`; `testTiedRangesCrossTogether` |
| `CROSS-05` | All-boundary continuation explicitly unsupported | `test_all_boundary_continuation_is_explicitly_rejected`; `testAllBoundaryStateIsExplicitlyUnsupported` |
| `CROSS-06` | Aggregate mismatch and invalid ticks rejected | `testRejectsAggregateMismatchAndInvalidTicks`; `test_rejects_invalid_ranges_and_trades` |

### D. Settlement through a real PoolManager

All cases below are in `contracts/test/OrbitalV4Hook.t.sol`, using a real `PoolManager` and v4-core's `PoolSwapTest`.

| Case ID | Scenario | Test |
| --- | --- | --- |
| `SETTLE-01` | Swaps revert before seeding; only the owner seeds, once | `testSwapsRevertBeforeSeed`, `testOnlyOwnerSeedsOnce` |
| `SETTLE-02` | Seed holds real inventory as manager claims (concentrated) | `testSeedHoldsRealInventoryAsManagerClaims` |
| `SETTLE-03` | 6-decimal in → 18-decimal out, and the reverse | `testSixDecimalInputPaysEighteenDecimalOutput`, `testEighteenDecimalInputPaysSixDecimalOutput` |
| `SETTLE-04` | All six pools advance one shared book | `testAllSixPairsAdvanceOneSharedBook` |
| `SETTLE-05` | Crossing and recovery through the manager | `testCrossingAndRecoveryThroughManager` |
| `SETTLE-06` | Slippage and deadline enforced from hook data | `testSlippageAndDeadlineAreEnforced` |
| `SETTLE-07` | Exact output, native liquidity, foreign pools and direct calls rejected | `testExactOutputIsRejected`, `testNativeLiquidityIsRejected`, `testForeignPoolsCannotInitialize`, `testDirectHookCallsAreRejected` |

### E. Range liquidity and attribution (`MATH-10`, `MATH-16`)

| Case ID | Scenario | Test |
| --- | --- | --- |
| `LP-01` | Interior attribution separates virtual and real inventory | `testInteriorAttributionSeparatesVirtualAndRealInventory` |
| `LP-02` | Boundary range keeps an independent redeemable inventory | `testBoundaryRangeKeepsAnIndependentRedeemableInventory` |
| `LP-03` | Range-specific share accounting; no cross-range withdrawal | `testBootstrapOffPegAdditionAndPartialWithdrawalStayRangeSpecific`, `testFullWithdrawalReturnsEveryLastUnit`, `testRejectsNonProportionalDeposit` |
| `LP-04` | Add/remove round trip through the hook, including a trapped range | `testAddAndRemoveLiquidityRoundTrip`, `testLiquidityGuards`, `testLiquidityChangesReachTheSwapBook`; `testBoundaryRangeLiquidityRoundTrip` |

### F. Fees and units (`MATH-13…15`)

| Case ID | Scenario | Test |
| --- | --- | --- |
| `FEE-01` | Fees split by weight, claimed by shares; new shares cannot claim the past; dust tracked | `testAllocatesSegmentFeesByWeightAndClaimsByShares`, `testNewSharesCannotClaimPastFeesAndDustIsTracked` |
| `FEE-02` | Controller-only collection; small raw fees survive large supplies (Q128) | `testOnlyControllerCollectsForAnOwner`, `testSmallRawFeesOverLargeShareSuppliesStayClaimable` |
| `FEE-03` | Fee accrues to ranges and an LP collects through the hook | `testFeeAccruesToRangesAndLpCollects` |
| `FEE-04` | Raw ↔ WAD conversion, rounding direction, overflow | `testStablecoinUnits`, `testRoundingDirection`, `testZero`, `testMaximumWad`, `testFuzzRawRoundTrip`, `testFuzzRoundingBounds`, `testFuzzRejectUnsupportedDecimals`, `testFuzzOverflowBoundary` |
| `FEE-05` | `mulDivDown` equals v4 `FullMath` when the product fits in 256 bits; SA-1 pinned | `testFuzzMatchesFullMathWhenProductFitsIn256Bits`, `testKnownIssueWideProductBranchRevertsInsteadOfWrapping` |

### G. Deployment

| Case ID | Scenario | Test |
| --- | --- | --- |
| `DEPLOY-01` | Demo script deploys, seeds and serves all six pools; a router swap settles | `testDemoScriptDeploysSeedsAndServesAllSixPools` |
| `DEPLOY-02` | Hook script sorts tokens, reads decimals and deploys at the mined address | `testHookScriptSortsExistingTokensAndDeploysAtMinedAddress` |

### H. Cross-language parity (`MATH-18`, `MATH-19`)

| Case ID | Scenario | Test |
| --- | --- | --- |
| `PARITY-01` | Solidity engine equals BigInt vectors (outputs, reserves, bitmaps, attribution) to the wei | `testSolidityMatchesBigIntVectorsExactly`; BigInt `the BigInt engine reproduces the shared Solidity/JS vectors exactly` |
| `PARITY-02` | PoolManager settlement equals the vectors to the wei | `testManagerSettlementMatchesSharedVectorsExactly` |
| `PARITY-03` | Legacy crossing fixture exact in Solidity and BigInt | `testTrapsFirstRangeAndContinues`; BigInt `matches the committed crossing trace exactly` |
| `PARITY-04` | Replay recomputes every transition and rejects tampered traces | BigInt `recomputes every transition…`, `rejects a transition whose recorded tick bitmap…` |

### I. App

Tests live in `app/src`.

| Case ID | Scenario | Test |
| --- | --- | --- |
| `APP-01` | Quote mirror reproduces the live testnet swap; 18 → 6 rounding; fee floor | `quote.test.ts` |
| `APP-02` | ABIs match forge-inspected selectors and the event topic | `abi.test.ts` |
| `APP-03` | Builders, reads, wallet discovery, network switch and revert explanations | `actions`, `reads`, `wallet` and `errors` `.test.ts` |
| `APP-04` | Uniswap-style app: swap quote exact to the wei, token selector search and flip, main-button states, approve → review → swap with custom slippage, wallet and account drawers (mint), network switch, pool positions and new-position preview, explore totals and tx links, app routing | `uni/UniApp.test.tsx` |
| `APP-05` | Sandbox fee mirror, max quotable input, depeg stress and trap prices | `simulator.test.ts` |
| `APP-06` | Landing/docs rendering, client-side routing, tabs, docs guide | `App.test.ts`, `App.render.test.tsx` |

## 3. Real-contract and live evidence

| Case ID | Scenario | Test |
| --- | --- | --- |
| `E2E-01` | Mint, approve and swap receive exactly the app's quote | `e2e.anvil.test.ts` · `mints, approves and swaps…` |
| `E2E-02` | Slippage revert explained before signing | `explains a slippage revert…` |
| `E2E-03` | Liquidity moves exactly the on-chain previews | `adds and removes range liquidity…` |
| `E2E-04` | Seeding LP collects exactly the simulated fees; history lists swaps | `collects the seeding LP's fees…` |
| `LIVE-01` | Recorded Unichain Sepolia book is seeded, solvent and quotable; live swap found | `live.testnet.test.ts` (opt-in) |

## 4. Invariants, fuzzing and resources

`TEST-5` **Invariant campaigns** run random swaps on every pool, range deposits and withdrawals, and fee collection. Two invariants must hold after every call:
- `invariant_custodyCoversRedeemableInventoryAndFees`
- `invariant_reserveBookStaysOnTheAggregateTorus`

Handlers do not swallow reverts. A swap into an unsupported region (for example, all ranges trapped) reverts atomically, and the campaign summary counts it (typically a few percent of swap calls), so the share of successful calls is always visible.

| Profile | Fuzz runs | Invariant runs / depth |
| --- | ---: | --- |
| Default (`make check`) | 256 | 24 / 12 |
| CI (`FOUNDRY_PROFILE=ci`) | 4,096 | 96 / 20 |

`TEST-6` **Gas** is measured through the manager and router (`OrbitalV4HookGasTest`), with budgets asserted:

| Operation | Budget |
| --- | --- |
| Ordinary swap | ≤ 1.6M |
| One crossing | ≤ 4.0M |
| Two crossings | ≤ 6.5M |
| Add or remove liquidity | ≤ 1.5M each |

Measured values are in [results/gas-baseline.md](results/gas-baseline.md).

`TEST-7` **Mutation checks.** Differential tests are spot-checked by mutation. For example, a 1-wei edit to a vector output must fail `PARITY-01`.

## 5. Definition of passing

`TEST-8` Passing requires:
- `make check` and `make app-e2e` pass with pinned tools (Foundry 1.7.1, Python 3.14.6, Node 22+).
- Formatting and `forge lint` report no warnings.
- Every static-analysis finding is triaged in [results/static-analysis.md](results/static-analysis.md).

Coverage percentage alone is not the gate. External audit and deployment approval are separate from test completion.
