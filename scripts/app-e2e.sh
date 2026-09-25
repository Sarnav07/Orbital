#!/usr/bin/env bash
# Deploys the Orbital demo to a throwaway anvil node and drives it with the app's
# own transaction builders (app/src/chain/e2e.anvil.test.ts).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${ORBITAL_E2E_PORT:-8546}"
RPC="http://127.0.0.1:${PORT}"
OUT="./deployments/anvil-e2e.json"
DEPLOYER_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

anvil --silent --port "$PORT" &
ANVIL_PID=$!
trap 'kill "$ANVIL_PID" 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do
  cast chain-id --rpc-url "$RPC" >/dev/null 2>&1 && break
  sleep 0.2
done

cd "$ROOT/contracts"
PRIVATE_KEY="$DEPLOYER_KEY" POOL_MANAGER=0x0000000000000000000000000000000000000000 DEPLOYMENT_OUT="$OUT" \
  forge script script/DeployOrbitalDemo.s.sol --rpc-url "$RPC" --broadcast >/dev/null
echo "Deployed demo to anvil: $(jq -r .hook "$OUT")"

cd "$ROOT/app"
ORBITAL_E2E_RPC="$RPC" ORBITAL_E2E_DEPLOYMENT_JSON="$(cat "$ROOT/contracts/deployments/anvil-e2e.json")" \
  npx vitest run src/chain/e2e.anvil.test.ts
