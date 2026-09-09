# Orbital testnet console

This dependency-free browser app is C15's read surface for the four-asset Orbital demo. Serve the repository with any static-file server, then open `app/` in a browser with an EIP-1193 wallet.

The committed manifest deliberately has no deployment, token or faucet addresses. It is valid configuration, but not a live deployment. Until a verified public-testnet deployment replaces those values, the app renders **awaiting deployment** rather than rendering unavailable reads as zero.

When configured, the app reads `reserves()`, `tickCount()`, `tickIsInterior(uint256)`, ERC-20 `balanceOf(address)`, and the optional range-share book's `sharesOf(uint256,address)` / `position(uint256)`. The only write path is an explicitly configured mock-token `mint(address,uint256)` faucet request; it is disabled when unconfigured.

Run the deterministic unit checks with:

```sh
npm test
```
