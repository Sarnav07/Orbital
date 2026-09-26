import { useEffect, useState } from "react";
import { NETWORKS, explorerAddressOn, type Network } from "../chain/networks";
import type { PoolStats } from "./services";
import { useUni } from "./state";
import { formatUsdCompact, shortAddress, tokensFor } from "./tokens";

type RowStats = PoolStats | "loading" | "failed";

/** Every Orbital pool, one per testnet, in the Uniswap pools-table layout. */
export function PoolsPage({ onOpen }: { onOpen: (network: Network) => void }) {
  const { statsFor } = useUni();
  const [search, setSearch] = useState("");
  const [stats, setStats] = useState<Record<string, RowStats>>(() => Object.fromEntries(NETWORKS.map((network) => [network.key, "loading"])));
  useEffect(() => {
    let cancelled = false;
    for (const network of NETWORKS) {
      statsFor(network)
        .then((value) => { if (!cancelled) setStats((current) => ({ ...current, [network.key]: value })); })
        .catch(() => { if (!cancelled) setStats((current) => ({ ...current, [network.key]: "failed" })); });
    }
    return () => { cancelled = true; };
  }, [statsFor]);

  const term = search.trim().toLowerCase();
  const rows = NETWORKS.filter((network) => !term
    || network.name.toLowerCase().includes(term)
    || network.deployment.symbols.some((symbol) => symbol.toLowerCase().includes(term))
    || network.deployment.hook.toLowerCase().includes(term));

  return <section className="uni-page">
    <div className="uni-page-head uni-pools-head">
      <div><h1>Pools</h1><p className="uni-muted">Multi-asset liquidity pools with capital-efficient ranges, keeping stablecoins at parity.</p></div>
      <label className="uni-search uni-pools-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input aria-label="Search pools" placeholder="Search pools, tokens or networks" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
    </div>
    <div className="uni-table uni-pools-table" role="table" aria-label="Orbital pools">
      <div role="row" className="uni-table-head"><span>Pool</span><span>Network</span><span>Address</span><span className="num">Volume 24H</span><span className="num">TVL</span><span /></div>
      {rows.length === 0 && <p className="uni-muted uni-table-note">No pools match “{search}”.</p>}
      {rows.map((network) => <PoolRow key={network.key} network={network} stats={stats[network.key]} onOpen={() => onOpen(network)} />)}
    </div>
  </section>;
}

function PoolRow({ network, stats, onOpen }: { network: Network; stats: RowStats; onOpen: () => void }) {
  const tokens = tokensFor(network.deployment);
  const [copied, setCopied] = useState(false);
  const value = (pick: (value: PoolStats) => bigint | null) => {
    if (stats === "loading") return "…";
    if (stats === "failed") return "—";
    const amount = pick(stats);
    return amount === null ? "—" : formatUsdCompact(amount);
  };
  const copy = (event: React.MouseEvent) => {
    event.stopPropagation();
    void navigator.clipboard?.writeText(network.deployment.hook).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => {});
  };
  return <div role="row" className="uni-pools-row" tabIndex={0} onClick={onOpen} onKeyDown={(event) => { if (event.key === "Enter") onOpen(); }}>
    <span className="uni-pools-pool"><span className="uni-logo-stack" aria-hidden="true">{tokens.map((token) => <img key={token.symbol} src={token.logo} alt="" />)}</span><strong>{tokens.map((token) => token.symbol).join(" / ")}</strong></span>
    <span className="uni-pools-chain"><img src={network.icon} alt="" /><span className="uni-pools-network">{network.name}</span></span>
    <span className="uni-pools-address">
      <a href={explorerAddressOn(network, network.deployment.hook)} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{shortAddress(network.deployment.hook)}</a>
      <button type="button" aria-label={`Copy ${network.name} hook address`} onClick={copy}>{copied ? "✓" : <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>}</button>
    </span>
    <span className="uni-pools-volume num">{value((current) => current.volume24h)}</span>
    <span className="uni-pools-tvl num">{value((current) => current.tvl)}</span>
    <span className="uni-pools-chevron" aria-hidden="true">›</span>
  </div>;
}
