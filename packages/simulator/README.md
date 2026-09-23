# Orbital browser simulator

This dependency-free ES module contains two browser-native `BigInt` tools: a versioned WAD transition replayer and a bounded exact-input quote engine mirroring the implemented Solidity solver. The quote engine advances four-asset reserve state, records tick crossings and recovery, and rejects unsupported or out-of-domain requests without using floating-point arithmetic.

It is an explanatory prototype model, not an oracle, live pool read, wallet interface, or settlement service. Run `npm test` from this directory.
