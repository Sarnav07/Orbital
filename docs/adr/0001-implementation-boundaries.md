# Independent geometry and shared-basket implementation

Status: accepted engineering direction; unresolved mathematical policies remain explicit in the specification.

Use a four-asset shared reserve book exposed through six v4 pair interfaces on Unichain Sepolia. Keep mathematical state independent from the v4 settlement adapter, wallet code and rendering.

Use Foundry with pinned Solidity/EVM settings for contracts. Build an independently authored Python Decimal reference using sphere/plane projection geometry. The reference must not port Solidity's future integer algorithm: distinct numerical implementations help expose shared rounding and algebra mistakes. Use explicit decimal inputs and isolated, selectable precision.

Build the browser simulator with TypeScript BigInt for eventual contract-rounding parity. Use React/Next.js, viem/wagmi and Three.js where useful for the interface; floating-point rendering must not feed pricing or accounting. Pin dependencies when introducing each consuming component.

Target exact-input trading and proportional per-range basket liquidity with a fixed fee. Numerical bounds, per-tick attribution, boundary-state LP policies and fee distribution remain engineering obligations rather than assumed behavior. See [the protocol specification](../SPECIFICATION.md).

Consequence: the public reference currently validates geometry only. Agreement between it and Solidity will be necessary, but is not sufficient to establish solvency or correct settlement.

## Amendment (2026-09-24): as-built stack and settlement

- The interface is Vite + React with `motion`, not Next.js, and has no Three.js. SVG renders all geometry; floating point is used only for display, never for pricing.
- The wallet layer is viem (pinned) with EIP-6963 injected-wallet discovery, not wagmi. It is code-split so the landing page does not load it, and it needs no API keys.
- The reference now also covers segmented trades (fixture `reference/fixtures/segmented-v1.json`), and the Solidity engine, PoolManager settlement and BigInt simulator agree exactly on `packages/fixtures/quote-vectors-v1.json`.
- The hook custodies the basket as v4 PoolManager ERC-6909 claims and settles swaps and range liquidity itself. v4-core pins `PoolManager` to solc 0.8.26, so Foundry auto-selects compilers per unit (`auto_detect_solc`) and tests deploy the manager from its separately compiled artifact.
