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
};

/** Recorded Unichain Sepolia deployment (contracts/deployments/unichain-sepolia.json). */
export const DEPLOYMENT = deployment as Deployment;
export const EXPLORER = "https://unichain-sepolia.blockscout.com";
/** First block of the deployment broadcast; logs before it cannot involve this hook. */
export const DEPLOY_BLOCK = 63_408_440n;
export const LIVE_SWAP_TX: Hash = "0x23e33f62af47efb078152ae5d8ef18b144f65771b6bc2cf87c7414c353e19e46";

/** Earliest block worth scanning for this deployment's events. */
export const deployBlockOf = (deployment: Deployment) => deployment.chainId === DEPLOYMENT.chainId ? DEPLOY_BLOCK : 0n;

export const explorerAddress = (address: string) => `${EXPLORER}/address/${address}`;
export const explorerTx = (hash: string) => `${EXPLORER}/tx/${hash}`;
