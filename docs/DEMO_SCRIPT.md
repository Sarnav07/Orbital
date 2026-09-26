# Orbital demo and submission script

## Submission pitch

### Title

**Orbital: one reserve book for n stablecoins**

### One-line summary

An experimental Uniswap v4 hook that trades n stablecoins through one shared reserve book instead of n(n − 1)/2 separately funded pair pools. It is live today as a 4-coin book on Unichain Sepolia, Ethereum Sepolia, Arbitrum Sepolia and Arc Testnet.

### Short project description

Stablecoin liquidity is often split across pair pools: USDC/USDT liquidity cannot directly reinforce DAI/FRAX liquidity. Orbital keeps one n-asset reserve state behind every pair pool. The deployment runs four coins behind six canonical Uniswap v4 pools. Its hook prices each exact-input swap with bounded sphere/torus geometry, holds the basket as PoolManager claims, and settles the trade itself. LPs choose a concentration range and earn that range's share of the fee.

This submission includes the Solidity hook with real PoolManager integration tests, deployment scripts, an independent Python geometry reference, a BigInt engine that agrees with Solidity to the wei, and an interactive sandbox.

Orbital is a testnet prototype on mock tokens with an internal security review (not a professional audit). It makes no claim of real-fund readiness or depeg protection.

## Recording script (about 8–10 minutes; trim freely)

### Prep

- **MetaMask on Unichain Sepolia** with a little ETH. Import the four mock tokens:
  - USDC `0xFc82C77256e74289f1B70f14126d21550C495a33`
  - USDT `0x4eBEa178D6a3F18C166cb8C5b67BA73dBCD26b4A`
  - DAI `0xD3c22D959fE356a4C0AA6B2e3A8B2C6cf04F2Aae`
  - FRAX `0x68400C108461BD3D6F2124D6B81127D5f2c1EF65`

  Mint test tokens once from the app's account drawer.
- **Terminal:**
  - `export RPC=https://sepolia.unichain.org`
  - `export HOOK=0x5fe242b3544Dd0d30C395843dE75A2B8d4dBA888`
  - `reserves()` is ordered `[USDT, FRAX, DAI, USDC]` (sorted by address).
- **Browser tabs:** landing page, `/app/sandbox`, `/app`. Hide bookmarks and notifications.

### 1. Problem (≈1:00) · landing hero → `/02 The problem`

Say: "Stablecoins all target one dollar, yet AMMs trade them in pairs. n coins need n(n−1)/2 pools: six for four coins, twenty-eight for eight. Each pool is funded separately, so depth on USDC/USDT does nothing for DAI/FRAX."

Walk the three cards:
- **Fragmented:** capital is split across pools.
- **Flat:** curve-style depth is wasted far from the peg, and v3 concentration only works for two tokens.
- **Fragile:** a flat pool keeps buying a failing coin.

### 2. Solution (≈0:45) · `/01 The thesis`, `/03 Mechanics`

Say: "Orbital, based on Paradigm's paper, puts every coin in one reserve book. It is a Uniswap v4 hook: the six pair pools are only doors into that book."

On Mechanics: "A sphere holds the reserves, a plane marks each LP's range, and a torus folds the active ranges together. LPs choose how tightly to sit around $1, like v3 ticks in n dimensions."

### 3. Principles and Protocol (≈0:45) · `/04`, `/05`

- **Principles:** shared route state; range-specific claims (an LP owns only its range's inventory); observed transitions (every crossing is recorded and replayable).
- **Protocol cards:** name each in a phrase, then click one **Learn more** to show it opens the docs.

### 4. Architecture and Route map (≈0:45) · `/06`, `/07`

- **Architecture:** scroll the cards. Pair interfaces (six v4 pools) → the Orbital hook (`beforeSwap` prices with the geometry) → settlement (the hook holds the basket as PoolManager ERC-6909 claims).
- **Route map:** "Every pair routes into the same hook and PoolManager. A USDC→DAI trade and a USDT→FRAX trade move the same state."

### 5. Simulator and docs (≈0:30) · `/08 Launch sandbox` → Docs

Say: "The simulator runs the same BigInt engine the contracts are tested against, to the wei."

Open `/docs` and point at the sidebar: "The docs map each piece back to the Paradigm paper if you want the math."

### 6. Sandbox: ranges and depeg stress (≈1:45) · `/app/sandbox`

1. Swap 10,000 USDC → DAI: the rate is about 1:1 and no range changes.
2. Swap 1,500,000: the curve point moves, **range 1 turns Boundary**, and each range shows its capital efficiency (13.1× / 6.6× / 2.0×). Say: "The narrow range gives the most depth near the peg. Once price leaves its band it stops trading instead of absorbing losses."
3. Open **Depeg stress** with USDT and step through it. Ranges trap near **$0.90** and **$0.80** while the wide range keeps trading; show each range's exposure to the failing coin. Say: "This answers Fragile: LPs choose how much depeg risk they carry."

### 7. Real swaps on-chain (≈2:00) · `/app` + MetaMask + terminal

1. Take the "before" snapshot in the terminal:
   - `cast call $HOOK "reserves()(uint256[4])" --rpc-url $RPC`
   - `cast call $HOOK "solvency()(uint256[4],uint256[4])" --rpc-url $RPC`
2. In MetaMask, show the four imported tokens and their balances.
3. In the app, swap 1,000 USDC → DAI:
   - Connect, then hover **Select token** to show the token preview.
   - Point at the fee line: 0.05%, paid to in-range LPs.
   - Approve the exact amount, then **Review** → **Swap**, confirm in MetaMask, and open the explorer link.
4. Run `reserves()` again: "Only the USDC and DAI coordinates moved."
5. Swap USDT → FRAX (a different pool) and run `reserves()` again. Say: "Different pool, same book. With pair pools, USDT/FRAX would need its own funded pool."
6. Open **Explore**: both swaps are listed with their pool name and a **You** badge.
7. Run `solvency()`: "The hook's PoolManager claims still cover every LP's inventory plus unpaid fees."
8. Optional: repeat once more (DAI → USDT), faster.

### 8. Proof and close (≈1:00)

1. Show `make check` (live or recorded). Say: "74 Solidity tests with invariant fuzzing, a Python reference, and a BigInt engine that matches Solidity to the wei."
2. Show [AUDIT.md](AUDIT.md): "A line-by-line security review found and fixed a real engine bug before this deployment."
3. Close: "Live on Unichain, Ethereum Sepolia, Arbitrum Sepolia and Arc. It is a testnet prototype on mock tokens, and every claim has a test or a transaction behind it."
4. End on the Pools page showing all four networks.

## Recording checklist

- Record terminal output from a clean `make check` run.
- Do not show private keys, RPC URLs with credentials, wallet seed phrases, or unverified transaction claims.
- Add the final immutable commit SHA, deployed addresses and transaction hashes to the submission description.

No walkthrough video is bundled with this source revision. Add a video URL only after it is recorded.
