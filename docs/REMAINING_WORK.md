# Remaining work for the final submission

This checklist tracks what is left before Orbital is submitted.

- **Section A (code): complete.** Every item has landed on `main`, with its evidence listed below.
- **Section B:** what only you can do. This is all that remains.
- **Section C:** limits deliberately left out of the prototype.

## Snapshot: already done

- **Real v4 settlement.** The hook takes swap input as PoolManager ERC-6909 claims, pays output from the shared book, normalizes decimals, charges the 0.05% fee, enforces optional `minAmountOut` and deadline, and runs range liquidity through `unlock`. See [MATH.md](MATH.md#7-fees-decimals-and-rounding) and the [implementation ledger](PAPER_IMPLEMENTATION.md#traceability).
- **Evidence.** 74 Solidity tests, including PoolManager integration, exact Solidity↔JS vectors with per-range attribution, deployment-script tests, boundary-status regressions, fuzzed solvency invariants and `FullMath` differentials. There are also 32 Python-reference, 13 simulator and 102 app tests. Everything runs through `make check`. `make app-e2e` adds 4 real-contract app tests.
- **Testnet.** The same pool is deployed on Unichain Sepolia, Ethereum Sepolia, Arbitrum Sepolia and Arc Testnet, each with a seeded mock basket and a live swap (1,000 USDC → 999.4334 DAI). Since 2026-09-26 every network runs the audited hook ([AUDIT.md](AUDIT.md)); every hook and fee book is source-verified (Blockscout on Unichain, exact Sourcify matches elsewhere). Addresses and transactions are in the [README deployment section](../README.md#deployed-contracts) and [RELEASE](RELEASE.md#deployment-provenance).
- **Frontend.** The [live site](https://orbital-protocol-mu.vercel.app) serves the landing story, the `/docs` guide, and `/app`, built in Uniswap's interface style under the Orbital brand. **Swap** is the live testnet swap on the network picked in the nav, **Pools** lists one pool per network and opens its range positions, **Explore** shows the live book and transactions, and **Sandbox** holds the local model and depeg stress.
- **Pitch and docs.**
  - Orbital is presented as an **n-dimensional** stablecoin AMM, with the live 4-coin book as its deployment.
  - The docs follow aqua-orbital's layout: a sidebar web guide at `/docs`, plus [MATH](MATH.md), [PAPER_IMPLEMENTATION](PAPER_IMPLEMENTATION.md) and [TESTS](TESTS.md).
  - Site typography is Arial throughout.
- **Cleanup.** The unused `RangeShareBook4` contract and its tests are removed. Build artifacts and private planning files are cleared.
- **Security review.** [AUDIT.md](AUDIT.md) records a line-by-line review. It found one High engine bug (a range could stay in range past its bound after a trade ended exactly on its plane, freezing LP withdrawals), two Low contract issues, a CI break, nine app issues and many doc drifts. All were fixed test-first, and the hook was redeployed on all four networks.

## A. Code work in this pass

The pre-audit deployments matched source commit `ff686ea`. The audit's contract fixes (a High engine bug plus SA-1) required new bytecode, so on 2026-09-26 the hook was redeployed on all four networks with `script/RedeployOrbitalHook.s.sol` and the records were updated. See [RELEASE](RELEASE.md#deployment-provenance).

- [x] **A1 · Live testnet app (`/app`, Uniswap-style Swap / Pool / Explore).**
  - **Read-only view, no wallet needed:** live reserves, range status, solvency and recent swaps.
  - **With an injected wallet (EIP-6963: MetaMask, Rabby, Coinbase…):**
    - connect, then switch to or add the network picked in the nav (Unichain Sepolia, Ethereum Sepolia, Arbitrum Sepolia or Arc)
    - faucet: mint 10,000 of each mock token
    - approve (exactly the amount needed), then swap with a live exact quote and 0.5% slippage
    - add, remove and collect range liquidity
  - Every transaction links to the explorer of the network it was sent on. Reverts are decoded into plain words, e.g. "Price moved beyond your slippage".
  - *Accept when* the app quote for a 1,000 USDC → DAI swap on the initial book equals the on-chain result exactly (`999433404420670936920`) and all app tests pass.
  - *Verify:* `cd app && npm test`.
  - **Done:** `app/src/uni/*` (Uniswap-style shell, swap, token selector, settings, review modal, pool positions, explore) on top of `app/src/chain/*`. The quote reproduces `999433404420670936920` exactly (`src/chain/quote.test.ts`), and a read-only live check passes against all four networks (`src/chain/live.testnet.test.ts`).
- [x] **A2 · Depeg stress view.**
  - **Model:** sell one coin into the demo book in steps. Each step shows the execution rate, which ranges trap, and each range's real-inventory exposure to the pressured coin.
  - **Parity:** range attribution is ported to the BigInt engine and asserted exactly against Solidity's `RangeLiquidity4.attribute`.
  - *Accept when* the attribution vectors match in both Solidity and JavaScript.
  - *Verify:* `make check`.
  - **Done:** `attributeRanges` in `packages/simulator/src/quote.js`. It is asserted to the wei in `contracts/test/QuoteVectors.t.sol` and `packages/simulator/test/vectors.test.js`. The model is the Sandbox's **Depeg stress** panel.
- [x] **A3 · Static analysis.**
  - Run Slither (or Aderyn) on `contracts/src`.
  - Triage every finding in `docs/results/static-analysis.md`.
  - *Accept when* no High/Medium true positive is left open.
  - **Done:** [static-analysis.md](results/static-analysis.md). Slither's 55 results contain no High or Medium true positive. The one Low true positive (SA-1) is fixed and deployed; a re-run after the audit fixes adds no new result.
- [x] **A4 · Real-contract E2E and CI.**
  - Add `make app-e2e`: deploy the demo to a local anvil node, then drive it with the app's own transaction builders (mint, approve, swap, slippage revert, add/remove/collect).
  - Add a CI job that runs it.
  - *Accept when* the received swap amount equals the app's quote exactly and the LP amounts equal the on-chain previews.
  - **Done:** `scripts/app-e2e.sh` and `app/src/chain/e2e.anvil.test.ts` (4/4), plus the `app-e2e` job in `.github/workflows/checks.yml`. The job failed on every CI run until the audit: a fresh checkout had no PoolManager artifact for `deployCode`. The script now builds first, and it passes from a clean worktree.
- [x] **A5 · Submission sheet and docs refresh.**
  - Write `docs/SUBMISSION.md` (pitch, links, verification steps, limits).
  - Update the README testnet-app section, the demo script beats, and RELEASE test counts and E2E evidence.
  - **Done:** [SUBMISSION.md](SUBMISSION.md), with **TODO (you)** fields for the video, final SHA and team. README, DEMO_SCRIPT, RELEASE and the ADR are refreshed.

## B. Needs you

- [ ] **B1 · Fund a demo wallet with testnet gas** (Unichain Sepolia ETH shown; Arc uses USDC). Swaps use about 1.2–4.8M gas, which is fractions of a cent at current prices. Faucets:
  - [Superchain Faucet](https://app.optimism.io/faucet): 0.05 ETH per 24 h
  - [QuickNode](https://faucet.quicknode.com/unichain/sepolia): one drip per 12 h
  - [thirdweb](https://thirdweb.com/unichain-sepolia-testnet): one drip per 24 h
  - Bridging Sepolia ETH through [Superbridge](https://superbridge.app/unichain-sepolia) also works.
- [ ] **B2 · Manual wallet QA** in a desktop browser with a wallet extension, on `/app`:
  1. Click **Connect** (top right), then pick your wallet in the drawer. If the wallet is on another network, click **Switch to <network>** and approve adding/switching.
  2. Click your address (top right), then **Mint test tokens**, and confirm four transactions. The drawer shows 10,000 of each token.
  3. Swap 100 USDC → DAI: pick DAI with **Select token**, click **Approve USDC** once, then **Review** → **Swap**. The received amount should match the quote, the toast should link to the network's explorer, and the swap should appear under **Explore → Transactions** with a **You** badge and its pool name.
  4. Enter an amount above your balance (for example 20,000,000). The button reads **Insufficient USDC balance**, because the balance is checked before the quote, and the quote's reason (the book cannot fill it) shows under the widget. The on-chain slippage revert itself is covered by `make app-e2e`.
  5. In **Pools**, open the pool, click **+ New position**, pick Range 2 at 0.1%, approve each token when asked, then **Add liquidity**. Open the position with **Manage**, **Remove** at Max, and try **Collect fees** after some swaps.
  6. Reload the page. It should show the book changes made by your transactions.
- [ ] **B3 · Record the ~3-minute video** following [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md), then paste the URL into the README and `docs/SUBMISSION.md`.
- [ ] **B4 · Submission form.** Add team members, contacts and the final commit SHA (`git rev-parse HEAD` after the last merge) to `docs/SUBMISSION.md` and the event's form.
- [ ] **B5 · (Optional) Tag the submitted revision:** `git tag v0.1.0-submission && git push origin v0.1.0-submission`.
- [x] **B6 · Source-verify every deployment.** Done during the audit: Blockscout for Unichain, exact Sourcify matches for Sepolia, Arbitrum Sepolia and Arc.

## C. Known limits, deliberately not addressed

These are documented in the [implementation ledger](PAPER_IMPLEMENTATION.md#open-obligations) and should stay visible in the video and submission. They are not bugs to fix before the deadline.

- All-boundary continuation. A swap that would trap every range reverts in full.
- No professional audit or economic review (an internal review is in [AUDIT.md](AUDIT.md)); mock tokens only.
- No production router or position manager. The demo router is v4-core's `PoolSwapTest`.
- Exact-output swaps are rejected.
- No fee governance, protocol fee or pause authority.
- The hook ignores `sqrtPriceLimitX96`; the `minAmountOut` hook data is the price guard.
- Fees are split across ranges interior at swap start, including a range that traps mid-swap.
- `collectFees` accepts any recipient, including `address(0)`. The app always pays the connected account.
- Injected browser wallets only; no WalletConnect/mobile flow.
