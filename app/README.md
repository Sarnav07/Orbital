# Orbital testnet console

This dependency-free browser app is C15's read surface for the four-asset Orbital demo. Serve the repository with any static-file server, then open `app/` in a browser with an EIP-1193 wallet.

The committed manifest deliberately has no deployment, token or faucet addresses. It is valid configuration, but not a live deployment. Until a verified public-testnet deployment replaces those values, the app renders **awaiting deployment** rather than rendering unavailable reads as zero.

When configured, the app reads `reserves()`, `tickCount()`, `tickIsInterior(uint256)`, ERC-20 `balanceOf(address)`, and the optional range-share book's `sharesOf(uint256,address)` / `position(uint256)`. The only write path is an explicitly configured mock-token `mint(address,uint256)` faucet request; it is disabled when unconfigured.

The route and range tickets in C16 validate decimal input exactly, bind a user-selected deadline, construct exact ERC-20 approval calls, and wait for successful receipts. They do **not** fabricate an Orbital swap or LP transaction: the current Solidity milestone has no settled router or position-manager ABI. Those action buttons remain unavailable until a verified deployment supplies the solver/settlement contracts and calldata schema.

C17's model inspector replays the versioned C14 WAD crossing fixture in the browser. Its triangle is an educational USDC/USDT/DAI projection that explicitly excludes FRAX; it is not a rendering of the four-asset invariant. Pair slices show shared reserve coordinates, while the range panel labels virtual floors separately from a tick's real-at-peg example. No panel claims live pool state or current redeemable LP inventory.

C18 adds three fixture scenarios: a reference peg, a USDT depeg-style flow modelled as an explicit USDT→USDC transition, and an opposing recovery flow. The external reference marker is illustrative context, never a contract write or price oracle. Each frame independently recomputes the `Torus4` residual/drift witness. When a verified hook is deployed, the comparison panel checks a successful receipt and a separate current hook read; it does not claim that the receipt caused the observed state.

Run the deterministic unit checks with:

```sh
npm test
```
