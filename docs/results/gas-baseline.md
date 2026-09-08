# C13 gas baseline

Measured locally with Foundry v1.7.1, Solidity 0.8.30, Cancun, optimizer runs 200 and `via_ir = true`. These are bounded local execution measurements, not a claim that total v4 router, ERC-20 settlement, or deployment gas is constant.

| Operation | Budget | Evidence |
|---|---:|---|
| Canonical exact-input route, no crossing | 1,500,000 gas | `testGasBudgetForOrdinaryAndCrossingRoutes` |
| First tick-crossing route | 3,500,000 gas | `testGasBudgetForOrdinaryAndCrossingRoutes` |
| Stateful 14-action route/recovery sequence | Not budgeted | 30.3M gas test execution; intended only for correctness coverage |
| Range attribution after crossing | Not budgeted | 2.97M gas test execution, including test fixture path |

The crossing route is intentionally allowed a materially larger budget: it evaluates the bounded root solver and changes tick state. C13 treats this as segmented work, not as a constant-time swap. Before testnet deployment, C11/C19 must measure actual manager settlement, token transfers, initialization, and LP/fee mutations separately.
