# Gas baseline

Measured locally with Foundry v1.7.1, Solidity 0.8.30 (hook) / 0.8.26 (PoolManager), Cancun, optimizer runs 200 and `via_ir = true`. Numbers come from `contracts/test/OrbitalV4HookParity.t.sol:OrbitalV4HookGasTest` at the demo configuration: three 10M-WAD ranges, a USDC(6)/USDT(6)/DAI(18)/FRAX(18) basket, 0.05% fee. Each is a full swap through the real v4 PoolManager and v4-core's `PoolSwapTest` router, including ERC-20 transfers and claim mint/burn.

| Operation | Measured | Test budget |
|---|---:|---:|
| Exact-input swap, no crossing (1,000 USDC → USDT) | 1,222,671 | 1,600,000 |
| Swap trapping one range (1.5M USDC → DAI) | 3,148,720 | 4,000,000 |
| Swap trapping two ranges (3M USDC → DAI) | 4,812,562 | 6,500,000 |
| Add 1% of a range's shares | 332,427 | 1,500,000 |
| Remove 1% of a range's shares | 178,155 | 1,500,000 |

Re-measured after the audit fixes ([AUDIT.md](../AUDIT.md)). The boundary-status check (finding C-1) adds about 3,000 gas to an ordinary swap and about 13,000 to a two-crossing swap.

On-chain checks agree. After a local anvil broadcast of `DeployOrbitalDemo`, a 1,000 USDT → USDC `cast send` swap used 1,232,869 gas. On the four live networks, the audited hook's 1,000 USDC → DAI swap with `minAmountOut`/deadline hook data used 1,228,848–1,235,447 gas. On Unichain Sepolia it used 1,235,447 (tx `0x59f6dfa9…840b2`).

Cost grows with crossings because each boundary is found by a bounded scan-and-bisect solver (48 samples, 96 iterations) and the book is re-aggregated. A swap may cross at most 8 boundaries. These are prototype measurements, not optimized production costs.
