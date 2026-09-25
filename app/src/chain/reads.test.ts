import { describe, expect, it } from "vitest";
import { DEPLOYMENT } from "./config";
import { DEPLOY_BLOCK } from "./config";
import { LOG_WINDOW, readAccount, readBook, readRecentSwaps, readSwapsBetween, type ReadClient } from "./reads";

const RADIUS = 10_000_000n * 10n ** 18n;
const ticks = [1001n, 1004n, 1050n].map((permille, index) => ({ radius: RADIUS, k: RADIUS * permille / 1000n, isInterior: index !== 0 }));

function fakeClient(overrides: Partial<Record<string, unknown>> = {}): ReadClient {
  return {
    readContract: async ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => {
      if (functionName in overrides) return overrides[functionName];
      switch (functionName) {
        case "reserves": return [1n, 2n, 3n, 4n];
        case "tickCount": return 3n;
        case "tickAt": return ticks[Number(args![0])];
        case "solvency": return [[5n, 5n, 5n, 5n], [4n, 4n, 4n, 4n]];
        case "feeLiability": return [0n, 0n, 0n, 9n];
        case "totalShares": return 100n + BigInt(args![0] as bigint);
        case "balanceOf": return 11n;
        case "allowance": return 0n;
        case "sharesOf": return 7n;
        default: throw new Error(`unexpected ${functionName}`);
      }
    },
    simulateContract: async () => ({ result: [0n, 0n, 1n, 0n] }),
    getBlockNumber: async () => DEPLOY_BLOCK + 1_000n,
    getLogs: async () => [{ args: { input: DEPLOYMENT.currencies[3], output: DEPLOYMENT.currencies[2], amountIn: 5n, amountOut: 4n, fee: 1n, crossings: 0n }, transactionHash: "0xabc", blockNumber: 999n }],
  } as unknown as ReadClient;
}

describe("chain reads", () => {
  it("assembles the live book the quote mirror needs", async () => {
    const book = await readBook(fakeClient(), DEPLOYMENT);
    expect(book.reserves).toEqual([1n, 2n, 3n, 4n]);
    expect(book.ticks.map((tick) => tick.isInterior)).toEqual([false, true, true]);
    expect(book.custody).toEqual([5n, 5n, 5n, 5n]);
    expect(book.required).toEqual([4n, 4n, 4n, 4n]);
    expect(book.solvent).toBe(true);
    expect(book.totalShares).toEqual([100n, 101n, 102n]);
    expect(book.decimals).toEqual(DEPLOYMENT.decimals);
    expect(book.fee).toBe(500n);
  });

  it("flags an insolvent snapshot", async () => {
    const book = await readBook(fakeClient({ solvency: [[1n, 5n, 5n, 5n], [4n, 4n, 4n, 4n]] }), DEPLOYMENT);
    expect(book.solvent).toBe(false);
  });

  it("reads balances, allowances, shares and simulated pending fees for an account", async () => {
    const state = await readAccount(fakeClient(), DEPLOYMENT, "0x000000000000000000000000000000000000dEaD", 3);
    expect(state.balances).toEqual([11n, 11n, 11n, 11n]);
    expect(state.routerAllowances).toEqual([0n, 0n, 0n, 0n]);
    expect(state.shares).toEqual([7n, 7n, 7n]);
    expect(state.pendingFees[0]).toEqual([0n, 0n, 1n, 0n]);
  });

  it("maps recent OrbitalSwap logs to asset indices and survives RPC errors", async () => {
    const recent = await readRecentSwaps(fakeClient(), DEPLOYMENT);
    expect(recent.ok).toBe(true);
    expect(recent.swaps[0]).toMatchObject({ input: 3, output: 2, amountIn: 5n, amountOut: 4n, hash: "0xabc" });
    const failing = { ...fakeClient(), getLogs: async () => { throw new Error("block range greater than 10000 max"); } } as unknown as ReadClient;
    expect(await readRecentSwaps(failing, DEPLOYMENT)).toMatchObject({ ok: false, swaps: [] });
  });

  it("scans history backwards in RPC-sized windows and stops at the deployment block", async () => {
    const windows: [bigint, bigint][] = [];
    const client = {
      ...fakeClient(),
      getBlockNumber: async () => DEPLOY_BLOCK + 25_000n,
      getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => { windows.push([fromBlock, toBlock]); return []; },
    } as unknown as ReadClient;
    const recent = await readRecentSwaps(client, DEPLOYMENT, { limit: 5, maxWindows: 10 });
    expect(recent.ok).toBe(true);
    expect(recent.scannedFrom).toBe(DEPLOY_BLOCK);
    expect(recent.latest).toBe(DEPLOY_BLOCK + 25_000n);
    expect(windows.every(([from, to]) => to - from + 1n <= LOG_WINDOW)).toBe(true);
    expect(windows[0][1]).toBe(DEPLOY_BLOCK + 25_000n);
    expect(windows.at(-1)![0]).toBe(DEPLOY_BLOCK);
  });

  it("reads newly mined swaps between two blocks in windows", async () => {
    const windows: [bigint, bigint][] = [];
    const client = { ...fakeClient(), getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => { windows.push([fromBlock, toBlock]); return []; } } as unknown as ReadClient;
    await readSwapsBetween(client, DEPLOYMENT, 100n, 100n + 2n * LOG_WINDOW);
    expect(windows).toHaveLength(3);
    expect(windows[0]).toEqual([100n, 100n + LOG_WINDOW - 1n]);
  });

  it("scans from genesis for deployments other than the recorded Sepolia one", async () => {
    const windows: [bigint, bigint][] = [];
    const client = {
      ...fakeClient(),
      getBlockNumber: async () => 500n,
      getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => { windows.push([fromBlock, toBlock]); return []; },
    } as unknown as ReadClient;
    const recent = await readRecentSwaps(client, { ...DEPLOYMENT, chainId: 31337 });
    expect(windows).toEqual([[0n, 500n]]);
    expect(recent.scannedFrom).toBe(0n);
  });
});
