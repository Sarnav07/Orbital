import { toHex } from "viem";
import { CHAIN, EXPLORER, RPC_URL } from "./config";

export type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
};
export type WalletInfo = { uuid: string; name: string; icon: string; rdns: string };
export type DiscoveredWallet = { info: WalletInfo; provider: Eip1193Provider };

type WalletHost = EventTarget & { ethereum?: Eip1193Provider };

/**
 * Discovers injected wallets through EIP-6963 announcements, falling back to a
 * legacy `window.ethereum`. Calls `onChange` with the deduplicated list and
 * returns an unsubscribe function.
 */
export function watchWallets(onChange: (wallets: DiscoveredWallet[]) => void, host: WalletHost = window as WalletHost) {
  const wallets = new Map<string, DiscoveredWallet>();
  const publish = () => {
    const list = [...wallets.values()];
    if (list.length === 0 && host.ethereum) {
      list.push({ info: { uuid: "legacy", name: "Browser wallet", icon: "", rdns: "legacy" }, provider: host.ethereum });
    }
    onChange(list);
  };
  const onAnnounce = (event: Event) => {
    const detail = (event as CustomEvent<DiscoveredWallet>).detail;
    if (!detail?.info?.uuid || wallets.has(detail.info.uuid)) return;
    wallets.set(detail.info.uuid, detail);
    publish();
  };
  host.addEventListener("eip6963:announceProvider", onAnnounce);
  host.dispatchEvent(new Event("eip6963:requestProvider"));
  publish();
  return () => host.removeEventListener("eip6963:announceProvider", onAnnounce);
}

const errorCode = (error: unknown) => (error as { code?: number; data?: { originalError?: { code?: number } } })?.code
  ?? (error as { data?: { originalError?: { code?: number } } })?.data?.originalError?.code;

/** Switches the wallet to Unichain Sepolia, adding the network first if the wallet does not know it. */
export async function ensureChain(provider: Eip1193Provider) {
  const chainId = toHex(CHAIN.id);
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (error) {
    if (errorCode(error) !== 4902 && !/unrecognized|not added|unknown chain/i.test(String((error as Error)?.message))) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId,
        chainName: CHAIN.name,
        nativeCurrency: CHAIN.nativeCurrency,
        rpcUrls: [RPC_URL],
        blockExplorerUrls: [EXPLORER],
      }],
    });
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  }
}

export async function requestAccounts(provider: Eip1193Provider) {
  return (await provider.request({ method: "eth_requestAccounts" })) as `0x${string}`[];
}

export async function currentChainId(provider: Eip1193Provider) {
  return Number(await provider.request({ method: "eth_chainId" }));
}
