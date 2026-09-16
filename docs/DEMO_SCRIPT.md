# Orbital demo and submission script

## Submission pitch

### Title

**Orbital: one reserve book for four stablecoins**

### One-line summary

An experimental Uniswap v4 hook that lets USDC, USDT, DAI, and FRAX trade through one shared reserve book instead of six separately funded pair pools.

### Short project description

Stablecoin liquidity is often split across pair pools: USDC/USDT liquidity cannot directly reinforce DAI/FRAX liquidity. Orbital keeps one four-asset reserve state behind six canonical pair routes. Its hook uses bounded sphere/torus geometry to compute the shared-book transition, while LP accounting remains range-specific.

This submission includes the Solidity hook prototype, an independent Python geometry reference, a BigInt replay engine, and a browser console. The console makes the important distinction between a pair interface and a separate pool, and it shows a depeg-style pressure scenario as an explicit trade rather than a price override.

Orbital is a prototype for mock/test environments. It has no verified public deployment, settlement router, or position-manager interface in this revision, so it does not claim live swaps or real-fund readiness.

## Three-minute recording script

### 0:00–0:20 — problem and thesis

Show the repository title or app hero. Say: “Four stablecoins create six pair routes. The usual implementation fragments liquidity across those routes. Orbital keeps one reserve book and lets every supported pair draw from it.”

### 0:20–0:50 — hook and shared state

Show [`OrbitalV4Hook.sol`](../contracts/src/OrbitalV4Hook.sol) and the canonical-pair tests. Say: “Each accepted pair maps into the same four-asset index space. The hook supplies custom `beforeSwap` accounting, so a USDC/USDT trade changes the same reserve state later visible to DAI and FRAX routes.”

### 0:50–1:20 — mathematical checks

Run `make check`, then show the passing output. Say: “The Solidity implementation is checked alongside an independent Python geometry model and an exact-BigInt transition replay. The test suite covers fixed-partition quotes, tick crossings, recovery, shared pair routes, and LP accounting.”

### 1:20–2:00 — browser replay

From the repository root, run `python3 -m http.server 4173` and open `http://127.0.0.1:4173/app/`. Advance **Cross the first boundary** once. Say: “This panel replays a committed WAD fixture. It is a computed model view, not an oracle or a live pool read.”

### 2:00–2:35 — depeg-style scenario

Select **USDT depeg-style pressure**. Say: “The 0.970 marker is context only. The reserve response comes from an explicit USDT-to-USDC trade. The adjacent witness recomputes the fixed-partition residual and displays the solver drift bound.”

### 2:35–3:00 — honest close

Show the deployment notice and [release limits](RELEASE.md#current-limits). Say: “The committed manifest intentionally has no deployed addresses or settlement ABI, so live writes are disabled. This is a technical prototype with reproducible model and contract evidence, not a production or public-testnet claim.”

## Recording checklist

- Record terminal output from a clean `make check` run.
- Record the app only after serving the repository root, not the `app/` directory by itself.
- Keep the deployment notice visible when explaining the current offline state.
- Do not show private keys, RPC URLs, wallet seed phrases, or unverified transaction claims.
- Add the final immutable commit SHA and any future verified deployment provenance to the submission description.

No walkthrough video is bundled with this source revision. This script is the reproducible recording plan; a video URL should be added only after it is recorded.
