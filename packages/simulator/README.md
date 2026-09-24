# Orbital browser simulator

This dependency-free ES module contains two browser-native `BigInt` tools: a bounded exact-input quote engine mirroring the implemented Solidity solver, and a versioned WAD transition replayer that recomputes every recorded transition with that engine and rejects any amount or tick bitmap it cannot reproduce exactly. The quote engine advances four-asset reserve state, records tick crossings and recovery, and rejects unsupported or out-of-domain requests without using floating-point arithmetic.

It is an explanatory prototype model, not an oracle, live pool read, wallet interface, or settlement service. Run `npm test` from this directory.

`npm run vectors` regenerates `packages/fixtures/quote-vectors-v1.json`. Solidity (`contracts/test/QuoteVectors.t.sol` and `OrbitalV4HookParity.t.sol`) asserts the same file exactly, through both the pure engine and a real PoolManager swap path.
