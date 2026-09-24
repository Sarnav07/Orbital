# Gas baseline

Measured locally with Foundry v1.7.1, Solidity 0.8.30 (hook) / 0.8.26 (PoolManager), Cancun, optimizer runs 200 and `via_ir = true`. Numbers come from `contracts/test/OrbitalV4HookParity.t.sol:OrbitalV4HookGasTest` at the demo configuration: three 10M-WAD ranges, a USDC(6)/USDT(6)/DAI(18)/FRAX(18) basket, 0.05% fee. Each is a full swap through the real v4 PoolManager and v4-core's `PoolSwapTest` router, including ERC-20 transfers and claim mint/burn.

| Operation | Measured | Test budget |
|---|---:|---:|
| Exact-input swap, no crossing (1,000 USDC → USDT) | 1,219,456 | 1,600,000 |
| Swap trapping one range (1.5M USDC → DAI) | 3,140,183 | 4,000,000 |
| Swap trapping two ranges (3M USDC → DAI) | 4,799,607 | 6,500,000 |
| Add 1% of a range's shares | 332,331 | 1,500,000 |
| Remove 1% of a range's shares | 178,046 | 1,500,000 |

A local anvil broadcast of `DeployOrbitalDemo` followed by a `cast send` 1,000 USDT → USDC swap used 1,232,869 gas.

Cost grows with crossings because each boundary is found by a bounded scan-and-bisect solver (48 samples, 96 iterations) and the book is re-aggregated. A swap may cross at most 8 boundaries. These are prototype measurements, not optimized production costs.
