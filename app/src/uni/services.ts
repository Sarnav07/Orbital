import { WaitForTransactionReceiptTimeoutError, createPublicClient, createWalletClient, custom, http, type Address, type Hash } from "viem";
import { hookAbi } from "../chain/abi";
import { DEFAULT_NETWORK, type Network } from "../chain/networks";
import { readAccount, readBook, readRecentSwaps, readSenders, readSwapsBetween, readVolume24h, type AccountState, type LiveBook, type RecentSwap } from "../chain/reads";
import { usdValue } from "./tokens";
import type { Eip1193Provider } from "../chain/wallet";

/** How long to wait for a receipt before reporting the transaction as still pending. */
export const RECEIPT_TIMEOUT_MS = 10 * 60_000;

export type ContractRequest = { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[] };

/** Everything the app does against the chain, injectable for tests. */
export type LiveServices = {
  readBook(): Promise<LiveBook>;
  readAccount(account: Address, rangeCount: number): Promise<AccountState>;
  readRecentSwaps(): Promise<{ ok: boolean; swaps: RecentSwap[]; latest: bigint }>;
  readSwapsBetween(fromBlock: bigint, toBlock: bigint): Promise<RecentSwap[]>;
  /** Sender of each swap transaction, keyed by hash; failed lookups are omitted. */
  readSenders(hashes: readonly Hash[]): Promise<Record<string, Address>>;
  blockNumber(): Promise<bigint>;
  previewLiquidity(kind: "add" | "remove", rangeId: number, shares: bigint): Promise<bigint[]>;
  /** Simulates from the account first (surfacing reverts before signing), then asks the wallet to send. */
  send(provider: Eip1193Provider, account: Address, request: ContractRequest): Promise<Hash>;
  /** "timeout" means not mined yet, not failed: the transaction may still land. */
  waitForReceipt(hash: Hash): Promise<"success" | "reverted" | "timeout">;
};

const clientFor = (network: Network) => createPublicClient({ chain: network.chain, transport: http(network.rpcUrl), batch: { multicall: true } });

export function createLiveServices(network: Network = DEFAULT_NETWORK): LiveServices {
  const deployment = network.deployment;
  const client = clientFor(network);
  return {
    readBook: () => readBook(client, deployment),
    readAccount: (account, rangeCount) => readAccount(client, deployment, account, rangeCount),
    readRecentSwaps: () => readRecentSwaps(client, deployment),
    readSwapsBetween: (fromBlock, toBlock) => readSwapsBetween(client, deployment, fromBlock, toBlock),
    readSenders: (hashes) => readSenders(client, hashes),
    blockNumber: () => client.getBlockNumber(),
    previewLiquidity: async (kind, rangeId, shares) => [...await client.readContract({
      address: deployment.hook,
      abi: hookAbi,
      functionName: kind === "add" ? "previewAddLiquidity" : "previewRemoveLiquidity",
      args: [BigInt(rangeId), shares],
    })],
    send: async (provider, account, request) => {
      const { request: simulated } = await client.simulateContract({ ...request, account } as never);
      const wallet = createWalletClient({ account, chain: network.chain, transport: custom(provider) });
      return wallet.writeContract(simulated as never);
    },
    waitForReceipt: async (hash) => {
      try {
        return (await client.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS })).status;
      } catch (error) {
        if (error instanceof WaitForTransactionReceiptTimeoutError) return "timeout";
        throw error;
      }
    },
  };
}

/** Pools-table figures in 18-decimal dollars; each side fails independently so one slow RPC cannot hide the other. */
export type PoolStats = { tvl: bigint | null; volume24h: bigint | null };
export type PoolStatsReader = (network: Network) => Promise<PoolStats>;

export const readPoolStats: PoolStatsReader = async (network) => {
  const client = clientFor(network);
  const decimals = network.deployment.decimals.map((value) => ({ decimals: value }));
  const [book, volume] = await Promise.allSettled([readBook(client, network.deployment), readVolume24h(client, network.deployment)]);
  return {
    tvl: book.status === "fulfilled" ? usdValue(decimals, book.value.custody) : null,
    volume24h: volume.status === "fulfilled" ? volume.value : null,
  };
};
