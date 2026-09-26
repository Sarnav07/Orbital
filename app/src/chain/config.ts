import { DEFAULT_NETWORK } from "./networks";

export * from "./deployment";
export * from "./networks";

/** The featured deployment (Unichain Sepolia); per-network values live in ./networks. */
export const CHAIN = DEFAULT_NETWORK.chain;
export const RPC_URL: string = DEFAULT_NETWORK.rpcUrl;
