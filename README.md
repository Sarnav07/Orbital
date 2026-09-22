# Orbital

One pool for every stablecoin.

An experimental Uniswap v4 hook applying Paradigm's Orbital geometry to a shared stablecoin reserve book. The initial target is four mock assets (USDC, USDT, DAI and FRAX), exposed through six pair interfaces. Unichain Sepolia is the configured target network, not a deployment claim. Pair interfaces are not independent liquidity reserves.

## Status

Prototype implementation. No verified public deployment or public settlement interface is configured. This repository is not audited and must not be used with real funds.

Implemented: token-unit normalization with explicit input/output rounding and overflow rejection; bounded four-asset geometry; fixed-partition no-fee quotes; tick trap/recovery transitions; a v4 `beforeSwap` adapter; range inventory/share accounting; and a dependency-free BigInt transition replayer. Decimal normalization does not assume that a token maintains its peg.

An independent Python reference covers sphere/tick geometry and no-fee segmented trades across the aggregate invariant. Solidity currently covers bounded four-asset geometry, fixed-partition no-fee quotes, bounded tick trap/recovery transitions, a v4 `beforeSwap` adapter, and per-range inventory attribution with proportional LP-share accounting. The adapter accepts canonical exact-input pair routes, advances one shared reserve book, and returns the official v4 custom delta that bypasses concentrated liquidity. Its local manager fixture verifies the delta's per-currency settlement legs; it is not a deployed PoolManager integration, production custody path, or public swap interface. Read the [protocol specification](docs/SPECIFICATION.md) and [reference guide](reference/README.md) for the supported mathematics and remaining obligations.

## Development

Install Foundry **v1.7.1**, Python **3.14.6**, Git and Make. Clone with `--recurse-submodules` so the pinned Uniswap v4-core interface dependency is available. The reference uses only Python's standard library. Solidity **0.8.30** is selected in `contracts/foundry.toml`; Foundry downloads that compiler when needed. The target EVM is Cancun.

From the repository root, run:

```sh
make check
```

Run the extended fuzz configuration with:

```sh
cd contracts
FOUNDRY_PROFILE=ci forge test -vv
```

The hook uses Uniswap v4 address flags. [`DeployOrbitalHook.s.sol`](contracts/script/DeployOrbitalHook.s.sol) mines its CREATE2 salt from the exact constructor calldata before broadcasting; required addresses and the private key are read only from environment variables. Running it is a separate authorized deployment action.

For a future testnet deployment, copy the tracked template and fill it only on your machine:

```sh
cp .env.example .env
# Edit .env with a dedicated testnet key, RPC URL, PoolManager, and four mock-token addresses.
```

Load it into the current shell before running Foundry:

```sh
set -a
source .env
set +a
cd contracts
forge script script/DeployOrbitalHook.s.sol:DeployOrbitalHook --rpc-url "$RPC_URL" --broadcast
```

The script requires the four token addresses in strictly ascending address order. `.env` is ignored by Git; never commit it or expose its values outside the authorized deployment environment.

The checks compile contracts, check formatting, report bytecode sizes and run tests. CI uses the same commands with an increased fuzz run count.

The dependency-free BigInt transition replayer is in [`packages/simulator`](packages/simulator). Run `npm test` in that directory to verify the versioned WAD crossing trace without floating-point arithmetic.

## Prior art

- [Paradigm: Orbital](https://www.paradigm.xyz/writing/orbital): mathematical design.
- [Oxkai/Orbital.Hook](https://github.com/Oxkai/Orbital.Hook): implementation reference and inspiration.

Project implementation is being authored independently. Attribution is not a claim of equivalence to, or endorsement by, either reference.
