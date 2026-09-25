import type { Address, Hash, PublicClient } from "viem";
import { hookAbi, tokenAbi } from "./abi";
import { deployBlockOf, type Deployment } from "./config";
import type { QuoteBook } from "./quote";

export type ReadClient = Pick<PublicClient, "readContract" | "simulateContract" | "getLogs" | "getBlockNumber">;
export type LiveBook = QuoteBook & {
  custody: bigint[];
  required: bigint[];
  feeLiability: bigint[];
  totalShares: bigint[];
  solvent: boolean;
};
export type AccountState = {
  balances: bigint[];
  routerAllowances: bigint[];
  hookAllowances: bigint[];
  shares: bigint[];
  pendingFees: bigint[][];
};
export type RecentSwap = {
  input: number;
  output: number;
  amountIn: bigint;
  amountOut: bigint;
  fee: bigint;
  crossings: bigint;
  hash: Hash;
  blockNumber: bigint;
};

const ZERO4 = () => [0n, 0n, 0n, 0n];

export async function readBook(client: ReadClient, deployment: Deployment): Promise<LiveBook> {
  const hook = { address: deployment.hook, abi: hookAbi } as const;
  const [reserves, tickCount, [custody, required], feeLiability] = await Promise.all([
    client.readContract({ ...hook, functionName: "reserves" }),
    client.readContract({ ...hook, functionName: "tickCount" }),
    client.readContract({ ...hook, functionName: "solvency" }),
    client.readContract({ ...hook, functionName: "feeLiability" }),
  ]);
  const ids = Array.from({ length: Number(tickCount) }, (_, index) => BigInt(index));
  const [ticks, totalShares] = await Promise.all([
    Promise.all(ids.map((id) => client.readContract({ ...hook, functionName: "tickAt", args: [id] }))),
    Promise.all(ids.map((id) => client.readContract({ ...hook, functionName: "totalShares", args: [id] }))),
  ]);
  return {
    reserves: [...reserves],
    ticks: ticks.map((tick) => ({ radius: tick.radius, k: tick.k, isInterior: tick.isInterior })),
    decimals: deployment.decimals,
    fee: BigInt(deployment.fee),
    custody: [...custody],
    required: [...required],
    feeLiability: [...feeLiability],
    totalShares,
    solvent: custody.every((held, index) => held >= required[index]),
  };
}

export async function readAccount(client: ReadClient, deployment: Deployment, account: Address, rangeCount: number): Promise<AccountState> {
  const token = (index: number) => ({ address: deployment.currencies[index], abi: tokenAbi } as const);
  const assets = [0, 1, 2, 3];
  const ranges = Array.from({ length: rangeCount }, (_, index) => BigInt(index));
  const [balances, routerAllowances, hookAllowances, shares, pendingFees] = await Promise.all([
    Promise.all(assets.map((index) => client.readContract({ ...token(index), functionName: "balanceOf", args: [account] }))),
    Promise.all(assets.map((index) => client.readContract({ ...token(index), functionName: "allowance", args: [account, deployment.router] }))),
    Promise.all(assets.map((index) => client.readContract({ ...token(index), functionName: "allowance", args: [account, deployment.hook] }))),
    Promise.all(ranges.map((id) => client.readContract({ address: deployment.hook, abi: hookAbi, functionName: "sharesOf", args: [id, account] }))),
    // collectFees has no view; simulating it from the account returns the claimable amounts without a transaction.
    Promise.all(ranges.map(async (id) => {
      try {
        const { result } = await client.simulateContract({ address: deployment.hook, abi: hookAbi, functionName: "collectFees", args: [id, account], account });
        return [...result];
      } catch {
        return ZERO4();
      }
    })),
  ]);
  return { balances, routerAllowances, hookAllowances, shares, pendingFees };
}

const SWAP_EVENT = hookAbi.find((item) => item.type === "event" && item.name === "OrbitalSwap")!;
/** Public Unichain RPCs reject eth_getLogs ranges above 10,000 blocks. */
export const LOG_WINDOW = 10_000n;

type SwapLog = { args: Record<string, unknown>; transactionHash: Hash | null; blockNumber: bigint | null };

function toSwaps(deployment: Deployment, logs: SwapLog[]): RecentSwap[] {
  const indexOf = (address: string) => deployment.currencies.findIndex((currency) => currency.toLowerCase() === address.toLowerCase());
  return logs.map((log) => ({
    input: indexOf(log.args.input as string),
    output: indexOf(log.args.output as string),
    amountIn: log.args.amountIn as bigint,
    amountOut: log.args.amountOut as bigint,
    fee: log.args.fee as bigint,
    crossings: log.args.crossings as bigint,
    hash: log.transactionHash as Hash,
    blockNumber: log.blockNumber as bigint,
  }));
}

async function logsIn(client: ReadClient, deployment: Deployment, fromBlock: bigint, toBlock: bigint) {
  const logs = await client.getLogs({ address: deployment.hook, event: SWAP_EVENT, fromBlock, toBlock });
  return toSwaps(deployment, logs as unknown as SwapLog[]);
}

/** Swaps mined in [fromBlock, toBlock], oldest first, read in RPC-sized windows. */
export async function readSwapsBetween(client: ReadClient, deployment: Deployment, fromBlock: bigint, toBlock: bigint) {
  const swaps: RecentSwap[] = [];
  for (let start = fromBlock; start <= toBlock; start += LOG_WINDOW) {
    const end = start + LOG_WINDOW - 1n < toBlock ? start + LOG_WINDOW - 1n : toBlock;
    swaps.push(...await logsIn(client, deployment, start, end));
  }
  return swaps;
}

/**
 * Newest OrbitalSwap events (newest first), scanning backwards from the head in
 * RPC-sized windows until `limit` swaps are found, `maxWindows` windows were read,
 * or the deployment block is reached. `latest` lets callers refresh incrementally.
 */
export async function readRecentSwaps(
  client: ReadClient,
  deployment: Deployment,
  { limit = 20, maxWindows = 30 }: { limit?: number; maxWindows?: number } = {},
) {
  const deployBlock = deployBlockOf(deployment);
  try {
    const latest = await client.getBlockNumber();
    const swaps: RecentSwap[] = [];
    let end = latest;
    let scannedFrom = latest + 1n;
    for (let window = 0; window < maxWindows && end >= deployBlock && swaps.length < limit; window += 1) {
      const start = end >= deployBlock + LOG_WINDOW - 1n ? end - LOG_WINDOW + 1n : deployBlock;
      swaps.push(...(await logsIn(client, deployment, start, end)).reverse());
      scannedFrom = start;
      if (start === 0n) break;
      end = start - 1n;
    }
    return { ok: true, swaps: swaps.slice(0, limit), latest, scannedFrom };
  } catch {
    return { ok: false, swaps: [] as RecentSwap[], latest: 0n, scannedFrom: 0n };
  }
}
