import { useEffect, useState, type ReactNode } from "react";
import { ExplorePage } from "./ExplorePage";
import { PoolPage } from "./PoolPage";
import { PoolsPage } from "./PoolsPage";
import { NETWORKS, isNetworkKey, networkByKey, type Network, type NetworkKey } from "../chain/networks";
import type { PoolStatsReader } from "./services";
import { UniProvider, useUni, type ServicesProp } from "./state";
import { SwapPage } from "./SwapPage";
import { type Token, formatAmount, formatUsd, shortAddress } from "./tokens";
import { Orbs } from "../ui/Orbs";
import { ThemeMenu } from "../ui/ThemeMenu";
import "./uni.css";

export type AppPage = "swap" | "pools" | "pool" | "explore" | "sandbox";
type Go = (route: "home" | "docs" | "app") => void;
type Location = { page: AppPage; pool?: NetworkKey };

const pathOf = ({ page, pool }: Location) =>
  page === "swap" ? "/app" : page === "pool" ? `/app/pools/${pool}` : `/app/${page}`;
function locationOf(path: string): Location {
  const pool = path.match(/^\/app\/pools\/([\w-]+)/)?.[1];
  if (pool && isNetworkKey(pool)) return { page: "pool", pool };
  if (path.startsWith("/app/pool")) return { page: "pools" };
  if (path.startsWith("/app/explore")) return { page: "explore" };
  if (path.startsWith("/app/sandbox")) return { page: "sandbox" };
  return { page: "swap" };
}

function useLocation(): [Location, (next: Location) => void] {
  const [location, setLocation] = useState<Location>(() => locationOf(window.location.pathname));
  useEffect(() => {
    const onPop = () => setLocation(locationOf(window.location.pathname));
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);
  const go = (next: Location) => {
    if (window.location.pathname !== pathOf(next)) history.pushState({}, "", pathOf(next));
    setLocation(next);
    scrollTo?.({ top: 0 });
  };
  return [location, go];
}

/** Orbital's app shell in the Uniswap interface style: nav, drawers, toasts and page routing. */
export function UniApp({ navigate, sandbox, services, stats, walletHost }: { navigate: Go; sandbox: ReactNode; services?: ServicesProp; stats?: PoolStatsReader; walletHost?: EventTarget }) {
  return <UniProvider services={services} stats={stats} walletHost={walletHost}><Shell navigate={navigate} sandbox={sandbox} /></UniProvider>;
}

function Shell({ navigate, sandbox }: { navigate: Go; sandbox: ReactNode }) {
  const [location, go] = useLocation();
  const { network, setNetwork } = useUni();
  // A pool URL names its network: opening it makes that network active.
  useEffect(() => {
    if (location.page === "pool" && location.pool && location.pool !== network.key) setNetwork(networkByKey(location.pool));
  }, [location, network.key, setNetwork]);
  const openPool = (next: Network) => { setNetwork(next); go({ page: "pool", pool: next.key }); };
  const chooseNetwork = (next: Network) => {
    setNetwork(next);
    if (location.page === "pool") go({ page: "pool", pool: next.key });
  };
  const page = location.page;
  const ready = page !== "pool" || location.pool === network.key;
  return <div className="uni">
    <Orbs fixed />
    <Nav page={page} go={(next) => go({ page: next })} navigate={navigate} onNetwork={chooseNetwork} />
    <main className="uni-main">
      {page === "swap" && <SwapPage key={network.key} />}
      {page === "pools" && <PoolsPage onOpen={openPool} />}
      {page === "pool" && ready && <div key={network.key}>
        <div className="uni-pool-bar">
          <a href="/app/pools" onClick={(event) => { event.preventDefault(); go({ page: "pools" }); }}>← Pools</a>
          <span className="uni-pool-network"><img src={network.icon} alt="" />{network.name}</span>
        </div>
        <PoolPage />
      </div>}
      {page === "explore" && <ExplorePage key={network.key} />}
      {page === "sandbox" && <div className="uni-sandbox">{sandbox}</div>}
    </main>
    <Drawers />
    <Toasts />
  </div>;
}

function OrbitalMark() {
  return <svg className="uni-mark" viewBox="0 0 32 32" aria-hidden="true">
    <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="2" />
    <ellipse cx="16" cy="16" rx="13" ry="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" transform="rotate(-28 16 16)" />
    <circle cx="16" cy="16" r="3.2" fill="currentColor" />
  </svg>;
}

function Nav({ page, go, navigate, onNetwork }: { page: AppPage; go: (page: AppPage) => void; navigate: Go; onNetwork: (network: Network) => void }) {
  const { account, wallet, onChain, setDrawer, switchNetwork, network } = useUni();
  const [menu, setMenu] = useState(false);
  const [networks, setNetworks] = useState(false);
  const active = (target: AppPage) => page === target || (target === "pools" && page === "pool");
  const link = (target: AppPage, label: string) => <a href={pathOf({ page: target })} className={active(target) ? "active" : ""} aria-current={active(target) ? "page" : undefined} onClick={(event) => { event.preventDefault(); go(target); }}>{label}</a>;
  return <header className="uni-nav">
    <div className="uni-nav-left">
      <a href="/" className="uni-brand" onClick={(event) => { event.preventDefault(); navigate("home"); }}><OrbitalMark /><span>Orbital</span></a>
      <nav className="uni-nav-links" aria-label="App">
        {link("swap", "Swap")}{link("pools", "Pools")}{link("explore", "Explore")}{link("sandbox", "Sandbox")}
        <a href="/docs" onClick={(event) => { event.preventDefault(); navigate("docs"); }}>Docs</a>
      </nav>
    </div>
    <div className="uni-nav-right">
      <div className="uni-menu-wrap">
        <button type="button" className="uni-network-button" aria-label={`Network: ${network.name}`} aria-expanded={networks} onClick={() => setNetworks(!networks)}>
          <img src={network.icon} alt="" /><span>{network.name}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        {networks && <div className="uni-menu uni-network-menu" role="menu">
          {NETWORKS.map((option) => <button type="button" role="menuitemradio" aria-checked={option.key === network.key} key={option.key} className={option.key === network.key ? "active" : ""} onClick={() => { setNetworks(false); onNetwork(option); }}>
            <img src={option.icon} alt="" /><span>{option.name}</span>{option.key === network.key && <i aria-hidden="true">✓</i>}
          </button>)}
        </div>}
      </div>
      <div className="uni-menu-wrap">
        <button type="button" className="uni-icon-button" aria-label="More" aria-expanded={menu} onClick={() => setMenu(!menu)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
        </button>
        {menu && <div className="uni-menu" role="menu">
          <ThemeMenu />
          <a role="menuitem" href="/" onClick={(event) => { event.preventDefault(); setMenu(false); navigate("home"); }}>Protocol</a>
          <a role="menuitem" href="https://github.com/Sarnav07/Orbital" target="_blank" rel="noreferrer">GitHub ↗</a>
          <a role="menuitem" href="https://www.paradigm.xyz/writing/orbital" target="_blank" rel="noreferrer">Orbital paper ↗</a>
        </div>}
      </div>
      {wallet && account && !onChain && <button type="button" className="uni-network-warn" onClick={() => void switchNetwork()}>Switch to {network.name}</button>}
      {wallet && account
        ? <button type="button" className="uni-account-button" onClick={() => setDrawer("account")}><Identicon address={account} />{shortAddress(account)}</button>
        : <button type="button" className="uni-connect" onClick={() => setDrawer("connect")}>Connect</button>}
    </div>
  </header>;
}

function Identicon({ address }: { address: string }) {
  const hue = parseInt(address.slice(2, 8), 16) % 360;
  return <span className="uni-identicon" style={{ background: `conic-gradient(from 90deg, hsl(${hue} 90% 60%), hsl(${(hue + 120) % 360} 90% 55%), hsl(${(hue + 240) % 360} 90% 60%), hsl(${hue} 90% 60%))` }} aria-hidden="true" />;
}

function Drawers() {
  const { tokens, network, explorerAddress, explorerTx, drawer, setDrawer, wallets, connect, account, accountState, disconnect, mint, busy } = useUni();
  if (drawer === "closed") return null;
  return <>
    <div className="uni-scrim" onClick={() => setDrawer("closed")} />
    <aside className="uni-drawer" aria-label={drawer === "connect" ? "Connect a wallet" : "Account"}>
      <button type="button" className="uni-drawer-close" aria-label="Close" onClick={() => setDrawer("closed")}>»</button>
      {drawer === "connect" ? <>
        <h2>Connect a wallet</h2>
        {wallets.length === 0
          ? <p className="uni-muted">No wallets detected. Install a browser wallet such as MetaMask or Rabby, then reload.</p>
          : <div className="uni-wallet-list">{wallets.map((candidate) => <button type="button" key={candidate.info.uuid} className="uni-wallet-option" onClick={() => void connect(candidate)}>
            {candidate.info.icon ? <img src={candidate.info.icon} alt="" /> : <span className="uni-wallet-fallback" aria-hidden="true">◎</span>}
            <span>{candidate.info.name}</span><small>Detected</small>
          </button>)}</div>}
        <p className="uni-drawer-foot">Testnet only · {network.name} · mock tokens</p>
      </> : account && <>
        <div className="uni-account-head"><Identicon address={account} /><div><strong>{shortAddress(account)}</strong><a href={explorerAddress(account)} target="_blank" rel="noreferrer">View on explorer ↗</a></div></div>
        <div className="uni-balances">
          <p className="uni-muted">Tokens</p>
          {tokens.map((token) => <div className="uni-balance-row" key={token.symbol}>
            <img src={token.logo} alt="" /><span><strong>{token.name}</strong><small>{token.symbol} · testnet mock</small></span>
            <span className="uni-balance-values"><strong>{accountState ? formatUsd(accountState.balances[token.index], token.decimals) : "—"}</strong><small>{accountState ? `${formatAmount(accountState.balances[token.index], token.decimals, 2)} ${token.symbol}` : ""}</small></span>
          </div>)}
        </div>
        <button type="button" className="uni-button uni-button-accent2" disabled={busy} onClick={() => void mint(tokens.map((token) => token.index))}>Mint test tokens</button>
        <p className="uni-drawer-foot">Mints 10,000 of each mock token. Four wallet confirmations; gas is {network.name} {network.chain.nativeCurrency.symbol}.</p>
        <button type="button" className="uni-button uni-button-ghost" onClick={disconnect}>Disconnect</button>
      </>}
    </aside>
  </>;
}

function Toasts() {
  const { tokens, network, explorerAddress, explorerTx, toasts, dismissToast } = useUni();
  if (!toasts.length) return null;
  const text = { signing: "Confirm in your wallet", pending: "Pending…", success: "Confirmed", failed: "Failed" };
  return <div className="uni-toasts" role="status">{toasts.map((toast) => <div key={toast.id} className={`uni-toast ${toast.status}`}>
    <span className="uni-toast-icon" aria-hidden="true">{toast.status === "success" ? "✓" : toast.status === "failed" ? "!" : ""}</span>
    <div><strong>{toast.label}</strong><small>{toast.status === "failed" && toast.message ? toast.message : text[toast.status]}</small>
      {toast.hash && <a href={explorerTx(toast.hash)} target="_blank" rel="noreferrer">View on explorer ↗</a>}</div>
    <button type="button" aria-label="Dismiss" onClick={() => dismissToast(toast.id)}>×</button>
  </div>)}</div>;
}
