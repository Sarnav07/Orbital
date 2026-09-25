import { unichainSepolia } from "viem/chains";

export * from "./deployment";

export const CHAIN = unichainSepolia;
export const RPC_URL: string = import.meta.env?.VITE_UNICHAIN_RPC_URL ?? "https://sepolia.unichain.org";
