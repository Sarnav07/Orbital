import type { Chain } from "viem";
import { arbitrumSepolia, arcTestnet, sepolia, unichainSepolia } from "viem/chains";
import unichainDeployment from "../../../contracts/deployments/unichain-sepolia.json";
import sepoliaDeployment from "../../../contracts/deployments/sepolia.json";
import arbitrumDeployment from "../../../contracts/deployments/arbitrum-sepolia.json";
import arcDeployment from "../../../contracts/deployments/arc-testnet.json";
import type { Deployment } from "./deployment";

export type NetworkKey = "unichain-sepolia" | "sepolia" | "arbitrum-sepolia" | "arc-testnet";

export type Network = {
  key: NetworkKey;
  name: string;
  chain: Chain;
  rpcUrl: string;
  explorer: string;
  icon: string;
  deployment: Deployment;
};

const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};

/** Every Orbital pool, one per testnet. Deployments are recorded by contracts/script/DeployOrbitalDemo.s.sol. */
export const NETWORKS: Network[] = [
  {
    key: "unichain-sepolia",
    name: "Unichain Sepolia",
    chain: unichainSepolia,
    rpcUrl: env.VITE_UNICHAIN_RPC_URL ?? "https://sepolia.unichain.org",
    explorer: "https://unichain-sepolia.blockscout.com",
    icon: "/networks/unichain.png",
    deployment: unichainDeployment as Deployment,
  },
  {
    key: "sepolia",
    name: "Ethereum Sepolia",
    chain: sepolia,
    rpcUrl: env.VITE_SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
    explorer: "https://sepolia.etherscan.io",
    icon: "/networks/ethereum.png",
    deployment: sepoliaDeployment as Deployment,
  },
  {
    key: "arbitrum-sepolia",
    name: "Arbitrum Sepolia",
    chain: arbitrumSepolia,
    rpcUrl: env.VITE_ARBITRUM_SEPOLIA_RPC_URL ?? "https://sepolia-rollup.arbitrum.io/rpc",
    explorer: "https://sepolia.arbiscan.io",
    icon: "/networks/arbitrum.png",
    deployment: arbitrumDeployment as Deployment,
  },
  {
    key: "arc-testnet",
    name: "Arc Testnet",
    chain: arcTestnet,
    rpcUrl: env.VITE_ARC_TESTNET_RPC_URL ?? "https://rpc.testnet.arc.network",
    explorer: "https://testnet.arcscan.app",
    icon: "/networks/arc.png",
    deployment: arcDeployment as Deployment,
  },
];

export const DEFAULT_NETWORK = NETWORKS[0];

export const networkByKey = (key: string): Network => NETWORKS.find((network) => network.key === key) ?? DEFAULT_NETWORK;
export const networkByChainId = (chainId: number): Network | undefined => NETWORKS.find((network) => network.chain.id === chainId);
export const isNetworkKey = (key: string): key is NetworkKey => NETWORKS.some((network) => network.key === key);

export const explorerAddressOn = (network: Network, address: string) => `${network.explorer}/address/${address}`;
export const explorerTxOn = (network: Network, hash: string) => `${network.explorer}/tx/${hash}`;
