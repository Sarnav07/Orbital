# Orbital demo and submission script

## Submission pitch

### Title

**Orbital: one reserve book for n stablecoins**

### One-line summary

An experimental Uniswap v4 hook that trades n stablecoins through one shared reserve book instead of n(n − 1)/2 separately funded pair pools. It is live today as a 4-coin book on Unichain Sepolia.

### Short project description

Stablecoin liquidity is often split across pair pools: USDC/USDT liquidity cannot directly reinforce DAI/FRAX liquidity. Orbital keeps one n-asset reserve state behind every pair pool. The deployment runs four coins behind six canonical Uniswap v4 pools. Its hook prices each exact-input swap with bounded sphere/torus geometry, holds the basket as PoolManager claims, and settles the trade itself. LPs choose a concentration range and earn that range's share of the fee.

This submission includes the Solidity hook with real PoolManager integration tests, deployment scripts, an independent Python geometry reference, a BigInt engine that agrees with Solidity to the wei, and an interactive sandbox.

Orbital is an unaudited prototype on mock tokens. It makes no claim of real-fund readiness or depeg protection.

## Three-minute recording script

### 0:00–0:20: problem and thesis

Show the app hero. Say: "n stablecoins create n(n − 1)/2 pair pools: six for four coins, twenty-eight for eight. The usual design fragments liquidity across them. Orbital keeps one reserve book and lets every pair draw from it. What you're about to see is the live 4-coin book." If time allows, open `/docs` briefly to show the protocol guide.

### 0:20–0:55: a real swap through the hook

Open `/app` with a funded wallet. Connect from the top-right button, mint test tokens from the account drawer if needed, select DAI, enter 1,000 USDC, approve, **Review** → **Swap**. Open the toast's Blockscout link, then show the swap in **Explore → Transactions**. As a fallback, show the [recorded live swap](https://unichain-sepolia.blockscout.com/tx/0x23e33f62af47efb078152ae5d8ef18b144f65771b6bc2cf87c7414c353e19e46). Say: "This USDC→DAI swap went through the real v4 PoolManager. The hook converted six-decimal USDC to the shared WAD book, charged 0.05%, minted the input as manager claims and burned DAI claims to pay out. Only the USDC and DAI coordinates of the one shared book moved."

### 0:55–1:35: sandbox, tick crossing and depeg stress

Open **Sandbox** from the app nav. Quote 1.5M USDC → DAI to show a tick crossing and the narrow range turning `BOUNDARY`. Scroll to **Depeg stress** with USDT selected: the narrow ranges trap near $0.90 and $0.80, and their USDT share stops growing while the wide range keeps absorbing. Say: "This is the same BigInt engine the contracts are checked against. Narrow ranges hold far less real inventory for the same depth near the peg. Under pressure they trap at their boundary instead of absorbing unbounded loss."

### 1:35–2:15: evidence

Run `make check` and show the summary. Point at `QuoteVectors.t.sol` / `OrbitalV4HookParity.t.sol` (Solidity, PoolManager settlement and JavaScript agree to the wei) and the invariant campaign (custody always covers redeemable inventory and fees).

### 2:15–2:40: LPs

Show `addLiquidity` / `removeLiquidity` / `collectFees` in the tests or on-chain. Say: "An LP buys shares of one range at that range's current basket. Withdrawals return only that range's inventory, and fees accrue to ranges that were live for the trade."

### 2:40–3:00: honest close

Show [release limits](RELEASE.md#current-limits). Say: "This is an unaudited prototype on mock tokens with explicit limits, such as no all-boundary continuation and no production router, but every claim here has a test or a transaction behind it."

## Recording checklist

- Record terminal output from a clean `make check` run.
- Do not show private keys, RPC URLs with credentials, wallet seed phrases, or unverified transaction claims.
- Add the final immutable commit SHA, deployed addresses and transaction hashes to the submission description.

No walkthrough video is bundled with this source revision. Add a video URL only after it is recorded.
