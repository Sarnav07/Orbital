# Orbital transition replay

This browser-native ES module replays versioned WAD traces with JavaScript `BigInt`. It applies exact settled input/output deltas and verifies transition shape, reserve bounds, and expected final state without floating-point arithmetic.

It is a trace replayer, not an independent pricing solver. The future quote simulator must implement and compare the bounded Solidity solver before it can quote new user inputs. Run `npm test` from this directory.
