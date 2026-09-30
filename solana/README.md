# Orbital on Solana

The same four-stablecoin Orbital book as the Uniswap v4 hook in `contracts/`, as a Solana program. One reserve book sits behind every pair, and LP ranges around the peg trap a depegging coin at their boundary.

| Path | What it is |
|---|---|
| `crates/orbital-math` | Rust port of the Solidity engine (`contracts/src/math`, `RangeFeeBook4`), plus on-chain settlement |
| `programs/orbital` | Anchor program: pool, vaults, positions, swap, add/remove liquidity, fees |
| `crates/orbital-cli` | Demo client: create mock coins and a seeded pool, show status, plan and send swaps |
| `programs/cu-bench` | Compute-unit benchmark of the maths inside the Solana VM |

## The maths matches Solidity to the wei

`orbital-math` is a line-for-line port with the same constants, rounding direction and errors. It is checked against:

- **`packages/fixtures/quote-vectors-v1.json`**: the vectors `contracts/test/QuoteVectors.t.sol` asserts. That's 9 swaps (including 1- and 2-crossing trades), with per-range attribution after each one.
- **`packages/fixtures/segmented-wad-v1.json`**: the simulator's segmented trace.
- **`tests/fixtures/random-v1.json`**: 240 seeded random trades from the BigInt engine across three range sets. 131 succeed and must match exactly; 109 fail and must fail with the same error.

The square root is the unique floor square root, seeded from a float estimate. It returns exactly what Solidity's `FixedPointMath.sqrt` returns; the test checks this on 20,000+ values and every power-of-two boundary.

## Why swaps are planned off-chain and checked on-chain

The Solidity hook solves the invariant inside `beforeSwap`: a 48-point scan and then up to 96 bisection steps. On Solana each residual evaluation costs about 23k compute units. Even a small swap solved on-chain runs past the 1.4M CU transaction limit (`programs/cu-bench` asserts this).

So the client plans the swap off-chain with the same engine (`segmented::plan_swap`) and sends the segments. The program checks each segment the way a constant-product AMM checks `x·y ≥ k` (`settle::settle_swap`):

- The post-segment reserves are on the solvent side of the current partition's invariant (residual ≤ 0), and within the Solidity solver's drift tolerance of the surface.
- They are on the physical arc of the torus cross-section (`w ≥ s_boundary`, `α_int ≤ 2·r_int`). On that arc the gap between the reserve path and the surface is convex in the output taken, so the solvent outputs are exactly `[0, first root]`.
- No segment passes a range plane. A segment that lands exactly on one (Solidity's crossing target) flips that range.

The planner rounds each root to the pool's side. The Solana quote is therefore at most 1 wei per segment below the Solidity quote, and never above it; across all fixture swaps the largest gap is 1 wei. Asking for more output, or skipping a crossing, is rejected.

## Measured

LiteSVM, three 10M ranges at k/r 1.001, 1.004 and 1.05, 0.05% fee:

| Instruction | Compute units |
|---|---|
| initialize_pool | 177k |
| seed | 106k |
| swap, no crossing | 323k–330k |
| swap, 1 crossing | 433k–493k |
| swap, 2 crossings | 646k |
| add_liquidity | 565k |
| remove_liquidity | 554k |
| collect_fees | 60k |

A 1,000 USDC → PYUSD swap from the balanced book returns 999.433404. That is the same amount, and leaves the same book state, as the live Unichain Sepolia hook's 1,000 USDC → DAI swap.

## Run it

```sh
# maths: unit tests, fixture vectors, random differential, settlement
cargo test -p orbital-math

# program: build, then the end-to-end LiteSVM test with real SPL mints
cargo build-sbf --manifest-path programs/orbital/Cargo.toml
cargo test -p orbital --test pool -- --nocapture

# compute-unit table
cargo build-sbf --manifest-path programs/cu-bench/Cargo.toml
cargo test -p cu-bench --test cu -- --nocapture
```

**Local validator demo:**

```sh
solana-test-validator --reset --bpf-program $(solana-keygen pubkey target/deploy/orbital-keypair.json) target/deploy/orbital.so
cargo build -p orbital-cli
solana airdrop 100 <your key> --url localhost
./target/debug/orbital-cli setup  --keypair <key.json> --out deployments/localnet.json
./target/debug/orbital-cli swap   --keypair <key.json> --deployment deployments/localnet.json mUSDC mPYUSD 1000
./target/debug/orbital-cli status --deployment deployments/localnet.json
```

For devnet, add `--url https://api.devnet.solana.com` after deploying with `solana program deploy`.

## Decisions and limits

- **Classic SPL Token only in v1.** Token-2022 mints such as PYUSD mainnet need extension checks (transfer fees, hooks) first.
- **SPL amounts are `u64`.** A coin with 18 decimals cannot hold millions of units, so Solana deployments use real 6-decimal stablecoins. The maths still normalises any decimals ≤ 18.
- **Slightly lower quotes than Solidity.** The planner's pool-side rounding means quotes can be up to 1 wei per segment below Solidity's. Everything else, including fees, range changes, locked seed shares and the fee book, follows the hook.
- **Not audited.** No mainnet deployment is planned before an audit.
