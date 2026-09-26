import { useEffect, useState } from "react";
import { addLiquidityRequest, approveRequest, collectFeesRequest, removeLiquidityRequest } from "../chain/actions";
import { singleDepegTrapPrice } from "../simulator";
import { useUni } from "./state";
import { type Token, formatAmount, formatUsd } from "./tokens";

const SLIPPAGE_BPS = 50;
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
const up = (value: bigint) => (value * BigInt(10_000 + SLIPPAGE_BPS) + 9_999n) / 10_000n;
const down = (value: bigint) => value * BigInt(10_000 - SLIPPAGE_BPS) / 10_000n;
type Four = readonly [bigint, bigint, bigint, bigint];

/** Sum of token amounts valued at $1 each (the agreed convention for the mock basket). */
const usdTotal = (tokens: Token[], amounts: bigint[]) => formatUsd(amounts.reduce((sum, amount, index) => sum + amount * 10n ** BigInt(18 - tokens[index].decimals), 0n), 18);

function LogoStack() {
  const { tokens } = useUni();
  return <span className="uni-logo-stack" aria-hidden="true">{tokens.map((token) => <img key={token.symbol} src={token.logo} alt="" />)}</span>;
}

function StatusPill({ interior }: { interior: boolean }) {
  return <span className={interior ? "uni-pill in-range" : "uni-pill out-range"}><i />{interior ? "In range" : "Out of range"}</span>;
}

export function PoolPage() {
  const { tokens, network, explorerAddress, explorerTx, book, account, wallet, accountState, setDrawer } = useUni();
  const [view, setView] = useState<{ kind: "list" } | { kind: "new" } | { kind: "detail"; range: number }>({ kind: "list" });
  if (view.kind === "new") return <NewPosition onBack={() => setView({ kind: "list" })} />;
  if (view.kind === "detail") return <PositionDetail range={view.range} onBack={() => setView({ kind: "list" })} />;

  const ticks = book?.ticks ?? [];
  const mine = ticks.map((_, index) => index).filter((index) => (accountState?.shares[index] ?? 0n) > 0n);
  return <section className="uni-page">
    <div className="uni-page-head">
      <h1>Your positions</h1>
      <button type="button" className="uni-button uni-button-accent" onClick={() => setView({ kind: "new" })}>+ New position</button>
    </div>
    <div className="uni-pool-grid">
      <div className="uni-positions">
        {!wallet || !account
          ? <div className="uni-empty"><h3>Connect your wallet</h3><p>Connect a wallet to view your positions.</p><button type="button" className="uni-button uni-button-accent2" onClick={() => setDrawer("connect")}>Connect wallet</button></div>
          : mine.length === 0
            ? <div className="uni-empty"><h3>No positions</h3><p>You don't have any liquidity positions. Create a new position to start earning fees.</p></div>
            : mine.map((index) => {
              const tick = ticks[index];
              const shares = accountState!.shares[index];
              const share = book ? Number(shares * 1_000_000n / book.totalShares[index]) / 10_000 : 0;
              return <article className="uni-position-card" key={index}>
                <div className="uni-position-top"><LogoStack /><div><strong>{tokens.map((token) => token.symbol).join(" / ")}</strong><small>Range {index + 1} · k/r {(Number(tick.k * 1000n / tick.radius) / 1000).toFixed(3)} · 0.05%</small></div><StatusPill interior={tick.isInterior} /></div>
                <dl><div><dt>Pool share</dt><dd>{share < 0.01 ? "<0.01" : share.toFixed(2)}%</dd></div><div><dt>Unpaid fees</dt><dd>{usdTotal(tokens, accountState!.pendingFees[index])}</dd></div></dl>
                <button type="button" className="uni-button uni-button-ghost" onClick={() => setView({ kind: "detail", range: index })}>Manage</button>
              </article>;
            })}
      </div>
      <aside className="uni-ranges">
        <h2>Ranges</h2>
        {ticks.map((tick, index) => {
          const ratio = Number(tick.k * 1000n / tick.radius) / 1000;
          const trap = singleDepegTrapPrice(ratio);
          return <div className="uni-range-row" key={index}><LogoStack /><div><strong>Range {index + 1}</strong><small>k/r {ratio.toFixed(3)}{trap !== null ? ` · traps near $${trap.toFixed(2)}` : ""}</small></div><StatusPill interior={tick.isInterior} /></div>;
        })}
        {!book && <p className="uni-muted">Loading ranges…</p>}
      </aside>
    </div>
  </section>;
}

function NewPosition({ onBack }: { onBack: () => void }) {
  const { tokens, network, explorerAddress, explorerTx, book, api, account, wallet, accountState, busy, run, setDrawer } = useUni();
  const [range, setRange] = useState<number | null>(null);
  const [bps, setBps] = useState(10);
  const [preview, setPreview] = useState<bigint[] | null>(null);
  const shares = book && range !== null ? book.totalShares[range] * BigInt(bps) / 10_000n : 0n;

  useEffect(() => {
    if (range === null || shares === 0n) return setPreview(null);
    let live = true;
    api.previewLiquidity("add", range, shares).then((amounts) => live && setPreview(amounts)).catch(() => live && setPreview(null));
    return () => { live = false; };
  }, [api, range, shares]);

  const maxIn = preview ? preview.map(up) : null;
  const needsApproval = maxIn && accountState ? maxIn.findIndex((amount, index) => accountState.hookAllowances[index] < amount) : -1;
  const short = maxIn && accountState ? maxIn.findIndex((amount, index) => accountState.balances[index] < amount) : -1;
  let action: { label: string; onClick?: () => void; disabled?: boolean; tone: string };
  if (!wallet || !account) action = { label: "Connect wallet", onClick: () => setDrawer("connect"), tone: "soft" };
  else if (range === null) action = { label: "Select a range", disabled: true, tone: "disabled" };
  else if (!maxIn) action = { label: "Enter an amount", disabled: true, tone: "disabled" };
  else if (short >= 0) action = { label: `Insufficient ${tokens[short].symbol} balance`, disabled: true, tone: "disabled" };
  else if (needsApproval >= 0) action = { label: `Approve ${tokens[needsApproval].symbol}`, onClick: () => void run(`Approve ${tokens[needsApproval].symbol}`, approveRequest(network.deployment, needsApproval, network.deployment.hook)), tone: "accent" };
  else action = { label: "Add liquidity", onClick: () => void run(`Add liquidity to range ${range + 1}`, addLiquidityRequest(network.deployment, range, shares, maxIn as unknown as Four, deadline())).then((ok) => ok && onBack()), tone: "accent" };

  return <section className="uni-page uni-narrow">
    <button type="button" className="uni-back" onClick={onBack}>← Your positions</button>
    <h1>New position</h1>
    <div className="uni-card">
      <p className="uni-step">Step 1 · Select a range</p>
      <p className="uni-muted">Every range holds all {tokens.length} coins. A narrower range concentrates liquidity closer to $1.</p>
      <div className="uni-range-options">{(book?.ticks ?? []).map((tick, index) => {
        const ratio = Number(tick.k * 1000n / tick.radius) / 1000;
        const trap = singleDepegTrapPrice(ratio);
        return <button type="button" key={index} className={range === index ? "uni-range-option selected" : "uni-range-option"} onClick={() => setRange(index)}>
          <strong>Range {index + 1}</strong><span>k/r {ratio.toFixed(3)}</span><small>{trap !== null ? `Traps near $${trap.toFixed(2)}` : "Widest"}</small><StatusPill interior={tick.isInterior} />
        </button>;
      })}</div>
    </div>
    <div className="uni-card">
      <p className="uni-step">Step 2 · Deposit amounts</p>
      <div className="uni-segment">{[1, 10, 100].map((option) => <button type="button" key={option} className={bps === option ? "active" : ""} onClick={() => setBps(option)}>{option / 100}% of range</button>)}</div>
      <div className="uni-deposit">
        {tokens.map((token) => <div className="uni-deposit-row" key={token.symbol}><img src={token.logo} alt="" /><span>{token.symbol}</span><strong>{preview ? formatAmount(preview[token.index], token.decimals, 4) : "0"}</strong><small>{preview ? formatUsd(preview[token.index], token.decimals) : "$0"}</small></div>)}
        {preview && <p className="uni-deposit-total">Total {usdTotal(tokens, preview)} · includes 0.5% slippage headroom on approval</p>}
      </div>
      <button type="button" className={`uni-main-button ${action.tone}`} disabled={action.disabled || busy} onClick={action.onClick}>{action.label}</button>
    </div>
  </section>;
}

function PositionDetail({ range, onBack }: { range: number; onBack: () => void }) {
  const { tokens, network, explorerAddress, explorerTx, book, api, account, accountState, busy, run } = useUni();
  const [bps, setBps] = useState(10_000);
  const [preview, setPreview] = useState<bigint[] | null>(null);
  const yourShares = accountState?.shares[range] ?? 0n;
  const shares = yourShares * BigInt(bps) / 10_000n;
  const tick = book?.ticks[range];
  const pending = accountState?.pendingFees[range] ?? [0n, 0n, 0n, 0n];

  useEffect(() => {
    if (shares === 0n) return setPreview(null);
    let live = true;
    api.previewLiquidity("remove", range, shares).then((amounts) => live && setPreview(amounts)).catch(() => live && setPreview(null));
    return () => { live = false; };
  }, [api, range, shares]);

  return <section className="uni-page uni-narrow">
    <button type="button" className="uni-back" onClick={onBack}>← Your positions</button>
    <div className="uni-page-head"><h1>Range {range + 1}</h1>{tick && <StatusPill interior={tick.isInterior} />}</div>
    <div className="uni-card">
      <p className="uni-step">Remove liquidity</p>
      <div className="uni-segment">{[2_500, 5_000, 7_500, 10_000].map((option) => <button type="button" key={option} className={bps === option ? "active" : ""} onClick={() => setBps(option)}>{option === 10_000 ? "Max" : `${option / 100}%`}</button>)}</div>
      <div className="uni-deposit">{tokens.map((token) => <div className="uni-deposit-row" key={token.symbol}><img src={token.logo} alt="" /><span>{token.symbol}</span><strong>{preview ? formatAmount(preview[token.index], token.decimals, 4) : "0"}</strong><small>{preview ? formatUsd(preview[token.index], token.decimals) : "$0"}</small></div>)}</div>
      <button type="button" className="uni-main-button accent" disabled={busy || !preview || !account} onClick={() => preview && void run(`Remove liquidity from range ${range + 1}`, removeLiquidityRequest(network.deployment, range, shares, preview.map(down) as unknown as Four, deadline())).then((ok) => ok && onBack())}>Remove</button>
    </div>
    <div className="uni-card">
      <p className="uni-step">Unpaid fees</p>
      <div className="uni-deposit">{tokens.map((token) => <div className="uni-deposit-row" key={token.symbol}><img src={token.logo} alt="" /><span>{token.symbol}</span><strong>{formatAmount(pending[token.index], token.decimals, 6)}</strong><small>{formatUsd(pending[token.index], token.decimals)}</small></div>)}</div>
      <button type="button" className="uni-main-button soft" disabled={busy || !account || pending.every((amount) => amount === 0n)} onClick={() => account && void run(`Collect range ${range + 1} fees`, collectFeesRequest(network.deployment, range, account))}>Collect fees</button>
    </div>
  </section>;
}
