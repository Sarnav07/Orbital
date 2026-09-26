import { createPublicClient, http } from "viem";
import { describe, expect, it } from "vitest";
import { NETWORKS } from "./networks";
import { quoteHookSwap } from "./quote";
import { readBook, readRecentSwaps } from "./reads";

// Read-only smoke test against every recorded Orbital deployment, over each network's public RPC.
// Opt in with ORBITAL_LIVE=1 npx vitest run src/chain/live.testnet.test.ts
const live = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.ORBITAL_LIVE;

describe.skipIf(!live).each(NETWORKS)("live $name deployment", (network) => {
  const client = createPublicClient({ chain: network.chain, transport: http(network.rpcUrl) });
  const deployment = network.deployment;

  it("reads a seeded, solvent three-range book that the app can quote", async () => {
    const book = await readBook(client, deployment);
    expect(book.ticks).toHaveLength(3);
    expect(book.solvent).toBe(true);
    expect(book.totalShares.every((shares) => shares > 0n)).toBe(true);
    const quote = quoteHookSwap(book, 0, 1, 10n ** BigInt(deployment.decimals[0]));
    expect(quote.amountOut).toBeGreaterThan(0n);
  }, 30_000);

  it("finds the recorded live swap in the hook's event history", async () => {
    const recent = await readRecentSwaps(client, deployment, { limit: 100, maxWindows: 200 });
    expect(recent.ok).toBe(true);
    expect(recent.swaps.some((swap) => swap.hash === deployment.liveSwapTx)).toBe(true);
  }, 60_000);
});
