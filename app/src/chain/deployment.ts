import type { Address, Hash } from "viem";
import deployment from "../../../contracts/deployments/unichain-sepolia.json";

// Plain constants only: the landing page imports this without pulling in viem at runtime.
export type Deployment = {
  chainId: number;
  poolManager: Address;
  hook: Address;
  feeBook: Address;
  router: Address;
  fee: number;
  tickSpacing: number;
  currencies: Address[];
  symbols: string[];
  decimals: number[];
  /** First block of the deployment broadcast; logs before it cannot involve this hook. */
  deployBlock: number;
  /** A recorded swap through the live pool, when one was made at deploy time. */
  liveSwapTx?: Hash;
};

/** Recorded Unichain Sepolia deployment (contracts/deployments/unichain-sepolia.json). */
export const DEPLOYMENT = deployment as Deployment;
export const EXPLORER = "https://unichain-sepolia.blockscout.com";
/** First block of the Unichain deployment broadcast. */
export const DEPLOY_BLOCK = BigInt(DEPLOYMENT.deployBlock);
export const LIVE_SWAP_TX: Hash = "0x23e33f62af47efb078152ae5d8ef18b144f65771b6bc2cf87c7414c353e19e46";

/** Earliest block worth scanning for this deployment's events. */
export const deployBlockOf = (deployment: Deployment) => BigInt(deployment.deployBlock ?? 0);

export const explorerAddress = (address: string) => `${EXPLORER}/address/${address}`;
export const explorerTx = (hash: string) => `${EXPLORER}/tx/${hash}`;
