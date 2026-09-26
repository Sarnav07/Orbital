import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Address, Hash } from "viem";
import { mintRequest } from "../chain/actions";
import { DEFAULT_NETWORK, explorerAddressOn, explorerTxOn, isNetworkKey, networkByKey, type Network } from "../chain/networks";
import { explainRevert } from "../chain/errors";
import { LOG_WINDOW, type AccountState, type LiveBook, type RecentSwap } from "../chain/reads";
import { currentChainId, ensureChain, requestAccounts, watchWallets, type DiscoveredWallet, type Eip1193Provider } from "../chain/wallet";
import { createLiveServices, readPoolStats, type ContractRequest, type LiveServices, type PoolStatsReader } from "./services";
import { tokensFor, type Token } from "./tokens";

export const REFRESH_MS = 8_000;
export const FAUCET_UNITS = 10_000n;

export type TxStatus = "signing" | "pending" | "success" | "failed";
/** `networkKey` and `href` pin a toast to the network its transaction was sent on. */
export type Toast = { id: number; label: string; status: TxStatus; networkKey: string; hash?: Hash; href?: string; message?: string };
export type Drawer = "closed" | "connect" | "account";
type StatusListener = (status: TxStatus, detail?: { hash?: Hash; message?: string }) => void;

export const NETWORK_KEY = "orbital:network";

/** Most blocks the live feed catches up in one poll; a longer gap (a sleeping tab) skips ahead. */
export const MAX_CATCH_UP_BLOCKS = 5n * LOG_WINDOW;

/** First block to scan when the feed last reached `scanned` and the chain is now at `latest`. */
export function catchUpFrom(scanned: bigint, latest: bigint): bigint {
  const next = scanned + 1n;
  const floor = latest > MAX_CATCH_UP_BLOCKS ? latest - MAX_CATCH_UP_BLOCKS + 1n : 0n;
  return next > floor ? next : floor;
}

const swapKey = (swap: RecentSwap) => `${swap.hash}:${swap.input}:${swap.output}:${swap.amountIn}`;

const STILL_PENDING = "Still pending: this transaction has not been mined yet. Check the explorer before trying again.";

/** Last network the visitor chose; storage failures fall back to the default network. */
export function readNetworkPreference(store?: Pick<Storage, "getItem"> | null): Network {
  try {
    const key = (store === undefined ? localStorage : store)?.getItem(NETWORK_KEY) ?? "";
    return isNetworkKey(key) ? networkByKey(key) : DEFAULT_NETWORK;
  } catch {
    return DEFAULT_NETWORK;
  }
}

type UniState = {
  api: LiveServices;
  network: Network;
  setNetwork(network: Network): void;
  tokens: Token[];
  explorerAddress(address: string): string;
  explorerTx(hash: string): string;
  statsFor: PoolStatsReader;
  book: LiveBook | null;
  bookError: string | null;
  blockNumber: bigint | null;
  swaps: RecentSwap[];
  swapsOk: boolean;
  swapsLoaded: boolean;
  /** Sender of each listed swap, keyed by tx hash, so Explore can mark the user's own swaps. */
  swapSenders: Record<string, Address>;
  wallets: DiscoveredWallet[];
  wallet: DiscoveredWallet | null;
  account: Address | null;
  chainId: number | null;
  onChain: boolean;
  accountState: AccountState | null;
  busy: boolean;
  toasts: Toast[];
  drawer: Drawer;
  setDrawer(drawer: Drawer): void;
  connect(wallet: DiscoveredWallet): Promise<void>;
  disconnect(): void;
  switchNetwork(): Promise<void>;
  run(label: string, request: ContractRequest, onStatus?: StatusListener): Promise<boolean>;
  mint(assets: number[]): Promise<void>;
  dismissToast(id: number): void;
};

const Context = createContext<UniState | null>(null);

export function useUni(): UniState {
  const value = useContext(Context);
  if (!value) throw new Error("useUni must be used inside UniProvider");
  return value;
}

export type ServicesProp = LiveServices | ((network: Network) => LiveServices);

export function UniProvider({ services, stats, walletHost, children }: { services?: ServicesProp; stats?: PoolStatsReader; walletHost?: EventTarget; children: ReactNode }) {
  const [network, setNetworkState] = useState<Network>(() => readNetworkPreference());
  const api = useMemo(() => (typeof services === "function" ? services(network) : services ?? createLiveServices(network)), [services, network]);
  const tokens = useMemo(() => tokensFor(network.deployment), [network]);
  const setNetwork = useCallback((next: Network) => {
    setNetworkState(next);
    try { localStorage.setItem(NETWORK_KEY, next.key); } catch { /* the choice still applies for this visit */ }
  }, []);
  const [book, setBook] = useState<LiveBook | null>(null);
  const [bookError, setBookError] = useState<string | null>(null);
  const [blockNumber, setBlockNumber] = useState<bigint | null>(null);
  const [swaps, setSwaps] = useState<RecentSwap[]>([]);
  const [swapsOk, setSwapsOk] = useState(true);
  const [swapsLoaded, setSwapsLoaded] = useState(false);
  const [swapSenders, setSwapSenders] = useState<Record<string, Address>>({});
  const sendersAsked = useRef(new Set<string>());
  const scannedTo = useRef<bigint | null>(null);
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [wallet, setWallet] = useState<DiscoveredWallet | null>(null);
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [accountState, setAccountState] = useState<AccountState | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [drawer, setDrawer] = useState<Drawer>("closed");
  const toastId = useRef(0);
  const onChain = chainId === network.chain.id;
  // Only transactions on the network being viewed hold the buttons.
  const busy = toasts.some((toast) => toast.networkKey === network.key && (toast.status === "signing" || toast.status === "pending"));

  // Reads started for a previous network or account must never land in the current view.
  const liveApi = useRef(api);
  liveApi.current = api;
  const liveAccount = useRef(account);
  liveAccount.current = account;
  const refreshQueue = useRef<Promise<void>>(Promise.resolve());

  const readOnce = useCallback(async () => {
    const source = api;
    const current = () => liveApi.current === source;
    try {
      const next = await api.readBook();
      if (!current()) return;
      setBook(next);
      setBookError(null);
      if (account) {
        const state = await api.readAccount(account, next.ticks.length);
        if (current() && liveAccount.current === account) setAccountState(state);
      }
    } catch (error) {
      if (current()) setBookError(explainRevert(error));
    }
    try {
      const latest = await api.blockNumber();
      if (!current()) return;
      setBlockNumber(latest);
      const scanned = scannedTo.current;
      if (scanned !== null && latest > scanned) {
        const fresh = await api.readSwapsBetween(catchUpFrom(scanned, latest), latest);
        if (!current() || scannedTo.current !== scanned) return;
        scannedTo.current = latest;
        if (fresh.length) {
          setSwaps((listed) => {
            const seen = new Set(listed.map(swapKey));
            return [...fresh.reverse().filter((swap) => !seen.has(swapKey(swap))), ...listed].slice(0, 25);
          });
        }
      }
    } catch {
      // The next poll retries.
    }
  }, [api, account]);

  // One read at a time: overlapping polls would scan the same blocks twice.
  const refresh = useCallback(() => {
    refreshQueue.current = refreshQueue.current.then(readOnce, readOnce);
    return refreshQueue.current;
  }, [readOnce]);

  // A different wallet account must not show the previous account's balances while its own load.
  useEffect(() => { setAccountState(null); }, [account]);

  useEffect(() => {
    let cancelled = false;
    // A new network starts from a clean slate: nothing read from the previous pool may leak in.
    setBook(null);
    setBookError(null);
    setBlockNumber(null);
    setAccountState(null);
    setSwaps([]);
    setSwapsOk(true);
    setSwapsLoaded(false);
    setSwapSenders({});
    sendersAsked.current = new Set();
    scannedTo.current = null;
    refreshQueue.current = Promise.resolve();
    api.readRecentSwaps().then((recent) => {
      if (cancelled) return;
      setSwapsOk(recent.ok);
      setSwaps(recent.swaps);
      setSwapsLoaded(true);
      scannedTo.current = recent.ok ? recent.latest : null;
    }).catch(() => { if (!cancelled) { setSwapsOk(false); setSwapsLoaded(true); } });
    return () => { cancelled = true; };
  }, [api]);

  // Look each swap's sender up once; a failed lookup is not retried, it just leaves the "You" badge off.
  useEffect(() => {
    const missing = swaps.map((swap) => swap.hash).filter((hash) => !sendersAsked.current.has(hash));
    if (!missing.length) return;
    missing.forEach((hash) => sendersAsked.current.add(hash));
    const source = api;
    api.readSenders(missing).then((found) => { if (liveApi.current === source) setSwapSenders((current) => ({ ...current, ...found })); }).catch(() => {});
  }, [api, swaps]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => watchWallets(setWallets, (walletHost ?? window) as EventTarget & { ethereum?: Eip1193Provider }), [walletHost]);

  useEffect(() => {
    if (!wallet) return;
    const onAccounts = (accounts: unknown) => setAccount(((accounts as Address[])[0]) ?? null);
    const onChainChanged = (id: unknown) => setChainId(Number(id));
    wallet.provider.on?.("accountsChanged", onAccounts);
    wallet.provider.on?.("chainChanged", onChainChanged);
    return () => {
      wallet.provider.removeListener?.("accountsChanged", onAccounts);
      wallet.provider.removeListener?.("chainChanged", onChainChanged);
    };
  }, [wallet]);

  const pushToast = (toast: Omit<Toast, "id" | "networkKey">) => {
    const id = ++toastId.current;
    setToasts((current) => [{ ...toast, id, networkKey: network.key }, ...current].slice(0, 4));
    return id;
  };
  const updateToast = (id: number, patch: Partial<Toast>) => setToasts((current) => current.map((toast) => toast.id === id ? { ...toast, ...patch } : toast));

  const connect = async (candidate: DiscoveredWallet) => {
    try {
      const [first] = await requestAccounts(candidate.provider);
      setWallet(candidate);
      setAccount(first ?? null);
      setChainId(await currentChainId(candidate.provider));
      setDrawer("closed");
    } catch (error) {
      pushToast({ label: "Connect wallet", status: "failed", message: explainRevert(error) });
    }
  };

  const disconnect = () => {
    setWallet(null);
    setAccount(null);
    setAccountState(null);
    setChainId(null);
    setDrawer("closed");
  };

  const switchNetwork = async () => {
    if (!wallet) return;
    try {
      await ensureChain(wallet.provider, network);
      setChainId(await currentChainId(wallet.provider));
    } catch (error) {
      pushToast({ label: "Switch network", status: "failed", message: explainRevert(error) });
    }
  };

  const run: UniState["run"] = async (label, request, onStatus) => {
    if (!wallet || !account) return false;
    const home = network;
    const id = pushToast({ label, status: "signing" });
    onStatus?.("signing");
    try {
      if (!onChain) {
        await ensureChain(wallet.provider, network);
        setChainId(network.chain.id);
      }
      const hash = await api.send(wallet.provider, account, request);
      updateToast(id, { status: "pending", hash, href: explorerTxOn(home, hash) });
      onStatus?.("pending", { hash });
      const status = await api.waitForReceipt(hash);
      if (status === "timeout") {
        // Not failed: the transaction may still be mined. Never invite a second submission.
        updateToast(id, { message: STILL_PENDING });
        onStatus?.("pending", { hash, message: STILL_PENDING });
        void api.waitForReceipt(hash).then((later) => {
          if (later === "timeout") return;
          updateToast(id, later === "success" ? { status: "success", message: undefined } : { status: "failed", message: "The transaction reverted on-chain." });
          void refresh();
        }).catch(() => {});
        return false;
      }
      await refresh();
      if (status === "success") {
        updateToast(id, { status: "success" });
        onStatus?.("success", { hash });
        return true;
      }
      const message = "The transaction reverted on-chain.";
      updateToast(id, { status: "failed", message });
      onStatus?.("failed", { hash, message });
      return false;
    } catch (error) {
      const message = explainRevert(error);
      updateToast(id, { status: "failed", message });
      onStatus?.("failed", { message });
      return false;
    }
  };

  const mint = async (assets: number[]) => {
    if (!account) return;
    for (const [step, asset] of assets.entries()) {
      const units = FAUCET_UNITS * 10n ** BigInt(network.deployment.decimals[asset]);
      const label = `Mint ${FAUCET_UNITS.toLocaleString()} ${network.deployment.symbols[asset]}${assets.length > 1 ? ` (${step + 1}/${assets.length})` : ""}`;
      if (!await run(label, mintRequest(network.deployment, asset, account, units))) return;
    }
  };

  const value: UniState = {
    api, network, setNetwork, tokens, statsFor: stats ?? readPoolStats,
    explorerAddress: (address) => explorerAddressOn(network, address),
    explorerTx: (hash) => explorerTxOn(network, hash),
    book, bookError, blockNumber, swaps, swapsOk, swapsLoaded, swapSenders, wallets, wallet, account, chainId, onChain, accountState, busy, toasts, drawer,
    setDrawer, connect, disconnect, switchNetwork, run, mint,
    dismissToast: (id) => setToasts((current) => current.filter((toast) => toast.id !== id)),
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
