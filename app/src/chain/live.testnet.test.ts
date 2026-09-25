import { createPublicClient, http } from "viem";
import { describe, expect, it } from "vitest";
import { CHAIN, DEPLOYMENT } from "./config";
import { quoteHookSwap } from "./quote";
import { readBook, readRecentSwaps } from "./reads";

// Read-only smoke test against the recorded Unichain Sepolia deployment.
// Opt in with ORBITAL_LIVE_RPC=https://sepolia.unichain.org npx vitest run src/chain/live.testnet.test.ts
const rpc = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.ORBITAL_LIVE_RPC;

describe.skipIf(!rpc)("live Unichain Sepolia deployment", () => {
  const client = createPublicClient({ chain: CHAIN, transport: http(rpc) });

  it("reads a seeded, solvent three-range book that the app can quote", async () => {
    const book = await readBook(client, DEPLOYMENT);
    expect(book.ticks).toHaveLength(3);
    expect(book.solvent).toBe(true);
    expect(book.totalShares.every((shares) => shares > 0n)).toBe(true);
    const quote = quoteHookSwap(book, 0, 1, 10n ** BigInt(DEPLOYMENT.decimals[0]));
    expect(quote.amountOut).toBeGreaterThan(0n);
  }, 30_000);

  it("finds the recorded live swap in the hook's event history", async () => {
    const recent = await readRecentSwaps(client, DEPLOYMENT, { limit: 100, maxWindows: 200 });
    expect(recent.ok).toBe(true);
    expect(recent.swaps.some((swap) => swap.hash === "0x23e33f62af47efb078152ae5d8ef18b144f65771b6bc2cf87c7414c353e19e46")).toBe(true);
  }, 30_000);
});
