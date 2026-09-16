# Validation matrix

This is the public C19 validation record for the browser console. It distinguishes deterministic checks from a public-testnet transaction: the committed manifest is intentionally `awaiting-deployment`, so it contains no addresses, test-token faucet, or settlement ABI.

## Clean browser smoke

Serve the repository root and open `/app/` as described in the [app README](./README.md). In an unconnected browser, verify:

- the deployment notice says values are unavailable rather than zero;
- wallet reads, faucet, swap, and LP controls are disabled;
- the replay advances from frame 0 to frame 1;
- the pressure scenario displays an explicit USDT-to-USDC modeled trade and the `within 1e-9 bound` witness;
- the confirmed-state control remains disabled without both a connected wallet and verified deployment manifest.

## Automated recovery coverage

`npm test` in `app/` checks the following behavior with deterministic providers and exact integer values:

| Condition | Required behavior |
| --- | --- |
| No wallet or wrong network | Read and workflow state remains unavailable; no transaction control is enabled. |
| No router or position manager | Swap and LP controls cannot be represented as executable operations. |
| User rejects approval | The rejection propagates; no receipt is read or shown as confirmation. |
| Pending or reverted receipt | It is not reported as a successful approval or confirmed state. |
| RPC or malformed return data | The read fails rather than rendering a fabricated zero value. |
| No verified quote / stale quote | The current prototype has no settlement router payload, so submission remains disabled rather than using an old or hypothetical quote. |
| Insufficient balance | Balances are rendered only from successful RPC reads; a missing or failed read is not coerced to zero. Execution requires a future verified settlement ABI. |

## Public-testnet gate

Do not treat this record as a testnet deployment claim. A live smoke test can begin only after a separately verified manifest supplies hook and token addresses, a router/position-manager calldata schema, and a funded test wallet. At that point, rerun the browser smoke above, exercise the configured faucet if present, and record transaction hashes plus independently refreshed hook reads.
