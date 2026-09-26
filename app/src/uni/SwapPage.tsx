import { useEffect, useMemo, useRef, useState } from "react";
import type { Hash } from "viem";
import { approveRequest, swapRequest } from "../chain/actions";
import { explainRevert } from "../chain/errors";
import { minAmountOut, quoteHookSwap, type HookQuote } from "../chain/quote";
import { useUni, type TxStatus } from "./state";
import { formatAmount, formatUsd, parseAmount, type Token } from "./tokens";

const AUTO_SLIPPAGE_BPS = 50;
const DEFAULT_DEADLINE_MINUTES = 20;

/** Plain (ungrouped) number for read-only amount inputs, at most 4 decimals. */
function inputValue(value: bigint, decimals: number) {
  const number = Number(value) / 10 ** decimals;
  return number.toLocaleString("en-US", { maximumFractionDigits: 4, useGrouping: false });
}

function TokenLogo({ token, size = 24 }: { token: Token; size?: number }) {
  return <img className="uni-token-logo" src={token.logo} alt="" width={size} height={size} />;
}

export function SwapPage() {
  const { tokens, network, explorerAddress, explorerTx, book, account, accountState, wallet, onChain, busy, setDrawer, switchNetwork, run } = useUni();
  const [sell, setSell] = useState<number>(tokens.find((token) => token.symbol === "USDC")?.index ?? 0);
  const [buy, setBuy] = useState<number | null>(null);
  const [amountText, setAmountText] = useState("");
  const [selecting, setSelecting] = useState<"sell" | "buy" | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [slippageBps, setSlippageBps] = useState<number | null>(null);
  const [deadlineMinutes, setDeadlineMinutes] = useState(DEFAULT_DEADLINE_MINUTES);
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Snapshot of the quote under review, so the modal survives the input clearing after success.
  const [review, setReview] = useState<{ quote: HookQuote; sell: Token; buy: Token; minOut: bigint; execRate: number; slippageBps: number; auto: boolean } | null>(null);
  const effectiveSlippage = slippageBps ?? AUTO_SLIPPAGE_BPS;

  const sellToken = tokens[sell];
  const buyToken = buy === null ? null : tokens[buy];
  const amount = parseAmount(amountText, sellToken.decimals);

  const quoted = useMemo<{ quote?: HookQuote; error?: string }>(() => {
    if (!book || buy === null || !amount) return {};
    try {
      return { quote: quoteHookSwap(book, sell, buy, amount) };
    } catch (error) {
      return { error: explainRevert(error) };
    }
  }, [book, sell, buy, amount]);
  const quote = quoted.quote;
  const minOut = quote ? minAmountOut(quote.amountOut, effectiveSlippage) : 0n;

  const spotRate = useMemo(() => {
    if (!book || buy === null) return null;
    try {
      const unit = 10n ** BigInt(sellToken.decimals);
      const small = quoteHookSwap(book, sell, buy, unit * 100n);
      return Number(small.amountOut) / 10 ** tokens[buy].decimals / 100;
    } catch {
      return null;
    }
  }, [book, sell, buy, sellToken.decimals]);
  const execRate = quote && buyToken ? (Number(quote.amountOut) / 10 ** buyToken.decimals) / (Number(quote.amountIn) / 10 ** sellToken.decimals) : null;
  const priceImpact = execRate !== null && spotRate ? Math.max(0, 1 - execRate / spotRate) : null;

  const choose = (side: "sell" | "buy", index: number) => {
    // Picking the token already on the other side flips the pair, as Uniswap does.
    if (side === "sell") {
      if (index === buy) setBuy(sell);
      setSell(index);
    } else {
      if (index === sell) setSell(buy ?? sell);
      setBuy(index);
    }
    setSelecting(null);
  };
  const flip = () => {
    if (buy === null) return;
    setSell(buy);
    setBuy(sell);
    setAmountText("");
  };

  const balance = accountState?.balances[sell] ?? 0n;
  const allowance = accountState?.routerAllowances[sell] ?? 0n;
  let main: { label: string; tone: "accent" | "soft" | "disabled" | "error"; onClick?: () => void };
  if (!wallet || !account) main = { label: "Connect wallet", tone: "soft", onClick: () => setDrawer("connect") };
  else if (!onChain) main = { label: `Switch to ${network.name}`, tone: "accent", onClick: () => void switchNetwork() };
  else if (buy === null) main = { label: "Select a token", tone: "disabled" };
  else if (!amount) main = { label: "Enter an amount", tone: "disabled" };
  else if (balance < amount) main = { label: `Insufficient ${sellToken.symbol} balance`, tone: "disabled" };
  else if (!quote) main = { label: "Insufficient liquidity for this trade", tone: "disabled" };
  else if (allowance < amount) main = { label: `Approve ${sellToken.symbol}`, tone: "accent", onClick: () => void run(`Approve ${sellToken.symbol}`, approveRequest(network.deployment, sell, network.deployment.router)) };
  else main = { label: "Review", tone: "accent", onClick: () => buyToken && setReview({ quote, sell: sellToken, buy: buyToken, minOut, execRate: execRate ?? 0, slippageBps: effectiveSlippage, auto: slippageBps === null }) };

  return <section className="uni-swap-page">
    <h1 className="uni-headline">Swap every stablecoin, one book.</h1>
    <div className="uni-swap">
      <div className="uni-tabs">
        <div role="tablist" aria-label="Trade type">
          <button type="button" role="tab" aria-selected="true" className="active">Swap</button>
          {["Limit", "Buy", "Sell"].map((tab) => <button type="button" role="tab" aria-selected="false" key={tab} disabled title="Not supported by this hook">{tab}</button>)}
        </div>
        <div className="uni-settings-wrap">
          <button type="button" className={slippageBps !== null ? "uni-settings-button custom" : "uni-settings-button"} aria-label="Settings" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)}>
            {slippageBps !== null && <span>{(slippageBps / 100).toString()}% slippage</span>}
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8.2-2.3-1.7-.9a6.8 6.8 0 0 0 0-2.6l1.7-.9-1.8-3.1-1.8.7a7 7 0 0 0-2.2-1.3L14 3.2h-4l-.4 1.9a7 7 0 0 0-2.2 1.3l-1.8-.7-1.8 3.1 1.7.9a6.8 6.8 0 0 0 0 2.6l-1.7.9 1.8 3.1 1.8-.7a7 7 0 0 0 2.2 1.3l.4 1.9h4l.4-1.9a7 7 0 0 0 2.2-1.3l1.8.7 1.8-3.1Z" /></svg>
          </button>
          {settingsOpen && <SettingsPopover slippageBps={slippageBps} setSlippageBps={setSlippageBps} deadline={deadlineMinutes} setDeadline={setDeadlineMinutes} />}
        </div>
      </div>

      <div className="uni-panel uni-panel-sell">
        <span className="uni-panel-label">Sell</span>
        <div className="uni-panel-row">
          <input aria-label="Sell amount" className="uni-amount" inputMode="decimal" autoComplete="off" placeholder="0" value={amountText}
            onChange={(event) => { const next = event.target.value.replace(",", "."); if (/^\d*\.?\d*$/.test(next)) setAmountText(next); }} />
          <TokenPill token={sellToken} onClick={() => setSelecting("sell")} />
        </div>
        <div className="uni-panel-foot">
          <span className="uni-usd">{amount ? formatUsd(amount, sellToken.decimals) : "$0"}</span>
          {accountState && <span className="uni-balance">{formatAmount(balance, sellToken.decimals, 4)} {sellToken.symbol}{balance > 0n && <button type="button" className="uni-max" onClick={() => setAmountText(String(Number(balance) / 10 ** sellToken.decimals))}>Max</button>}</span>}
        </div>
      </div>

      <button type="button" className="uni-flip" aria-label="Switch tokens" onClick={flip}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v15m0 0-6-6m6 6 6-6" /></svg>
      </button>

      <div className="uni-panel uni-panel-buy">
        <span className="uni-panel-label">Buy</span>
        <div className="uni-panel-row">
          <input aria-label="Buy amount" className="uni-amount" readOnly placeholder="0" value={quote && buyToken ? inputValue(quote.amountOut, buyToken.decimals) : ""} />
          <TokenPill token={buyToken} onClick={() => setSelecting("buy")} />
        </div>
        <div className="uni-panel-foot">
          <span className="uni-usd">{quote && buyToken ? formatUsd(quote.amountOut, buyToken.decimals) : ""}</span>
          {accountState && buyToken && <span className="uni-balance">{formatAmount(accountState.balances[buyToken.index], buyToken.decimals, 4)} {buyToken.symbol}</span>}
        </div>
      </div>

      <button type="button" className={`uni-main-button ${main.tone}`} disabled={main.tone === "disabled" || busy} onClick={main.onClick}>{main.label}</button>

      {quote && buyToken && <div className="uni-details">
        <button type="button" className="uni-details-toggle" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(!detailsOpen)}>
          <span className="uni-rate">1 {sellToken.symbol} = {(execRate ?? 0).toFixed(4)} {buyToken.symbol} <small>(${(execRate ?? 0).toFixed(2)})</small></span>
          <span className="uni-details-right">Fee {formatAmount(quote.fee, sellToken.decimals, 4)} {sellToken.symbol}<svg viewBox="0 0 24 24" aria-hidden="true" className={detailsOpen ? "open" : ""}><path d="m6 9 6 6 6-6" /></svg></span>
        </button>
        {detailsOpen && <dl className="uni-details-body">
          <div><dt>Fee (0.05%)</dt><dd>{formatAmount(quote.fee, sellToken.decimals, 6)} {sellToken.symbol}</dd></div>
          <div><dt>Network</dt><dd>{network.name}</dd></div>
          <div><dt>Price impact</dt><dd>{priceImpact === null ? "—" : `${(priceImpact * 100).toFixed(2)}%`}</dd></div>
          <div><dt>Max slippage</dt><dd>{slippageBps === null ? <><span className="uni-tag">Auto</span> 0.5%</> : `${slippageBps / 100}%`}</dd></div>
          <div><dt>Min. received</dt><dd>{formatAmount(minOut, buyToken.decimals, 4)} {buyToken.symbol}</dd></div>
          <div><dt>Range crossings</dt><dd>{quote.crossings}</dd></div>
          <div><dt>Order routing</dt><dd>Orbital hook · one shared book</dd></div>
        </dl>}
      </div>}
      {quoted.error && buyToken && <p className="uni-quote-error" role="status">{quoted.error}</p>}
    </div>
    <p className="uni-footer-note">Trade n stablecoins through <span>one shared reserve book</span>, live as a 4-coin book on {network.name}.</p>

    {selecting && <TokenSelectModal
      title="Select a token"
      balances={accountState?.balances}
      onClose={() => setSelecting(null)}
      onSelect={(index) => choose(selecting, index)}
      selected={selecting === "sell" ? sell : buy}
    />}
    {review && <ReviewModal
      sellToken={review.sell} buyToken={review.buy} quote={review.quote} minOut={review.minOut} slippageBps={review.slippageBps} auto={review.auto} execRate={review.execRate}
      onClose={() => setReview(null)}
      onConfirm={(onStatus) => run(`Swap ${formatAmount(review.quote.amountIn, review.sell.decimals, 4)} ${review.sell.symbol} for ${review.buy.symbol}`, swapRequest(network.deployment, {
        input: review.sell.index, output: review.buy.index, amountIn: review.quote.amountIn, minAmountOut: review.minOut,
        deadline: BigInt(Math.floor(Date.now() / 1000) + deadlineMinutes * 60),
      }), onStatus).then((ok) => { if (ok) setAmountText(""); return ok; })}
    />}
  </section>;
}

function TokenPill({ token, onClick }: { token: Token | null; onClick: () => void }) {
  const chevron = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>;
  return token
    ? <button type="button" className="uni-token-pill" onClick={onClick}><TokenLogo token={token} /><span>{token.symbol}</span>{chevron}</button>
    : <button type="button" className="uni-token-pill empty" onClick={onClick}><span>Select token</span>{chevron}</button>;
}

function SettingsPopover({ slippageBps, setSlippageBps, deadline, setDeadline }: {
  slippageBps: number | null; setSlippageBps: (value: number | null) => void; deadline: number; setDeadline: (value: number) => void;
}) {
  const [text, setText] = useState(slippageBps === null ? "" : String(slippageBps / 100));
  const custom = slippageBps !== null;
  const warning = custom && slippageBps! > 500 ? "Your transaction may be frontrun and result in an unfavorable trade." : custom && slippageBps! < 5 ? "Slippage below 0.05% may cause the transaction to fail." : null;
  return <div className="uni-popover" role="dialog" aria-label="Swap settings">
    <div className="uni-setting">
      <span>Max slippage <i title="Your transaction will revert if the price changes unfavorably by more than this percentage.">ⓘ</i></span>
      <div className="uni-slippage">
        <button type="button" className={custom ? "" : "active"} onClick={() => { setSlippageBps(null); setText(""); }}>Auto</button>
        <label className={custom ? "active" : ""}><input aria-label="Custom slippage" inputMode="decimal" placeholder="0.50" value={text} onChange={(event) => {
          const next = event.target.value;
          if (!/^\d*\.?\d{0,2}$/.test(next)) return;
          setText(next);
          const value = Number(next);
          setSlippageBps(next === "" || !Number.isFinite(value) || value <= 0 ? null : Math.min(5_000, Math.round(value * 100)));
        }} />%</label>
      </div>
    </div>
    {warning && <p className="uni-warning">{warning}</p>}
    <div className="uni-setting">
      <span>Tx deadline <i title="Your transaction will revert if it is pending for longer than this.">ⓘ</i></span>
      <label className="uni-deadline"><input aria-label="Transaction deadline" inputMode="numeric" value={deadline} onChange={(event) => { const value = Number(event.target.value.replace(/\D/g, "")); setDeadline(Math.max(1, Math.min(4_320, value || 1))); }} />minutes</label>
    </div>
  </div>;
}

export function TokenSelectModal({ title, balances, selected, onSelect, onClose }: {
  title: string; balances?: bigint[]; selected: number | null; onSelect: (index: number) => void; onClose: () => void;
}) {
  const { tokens } = useUni();
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);
  const term = search.trim().toLowerCase();
  const matches = tokens.filter((token) => !term || token.symbol.toLowerCase().includes(term) || token.name.toLowerCase().includes(term) || token.address.toLowerCase() === term);
  return <>
    <div className="uni-scrim" onClick={onClose} />
    <div className="uni-modal uni-token-modal" role="dialog" aria-label={title}>
      <div className="uni-modal-head"><h2>{title}</h2><button type="button" aria-label="Close" onClick={onClose}>×</button></div>
      <label className="uni-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input ref={inputRef} aria-label="Search tokens" placeholder="Search tokens" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <div className="uni-chips">{tokens.map((token) => <button type="button" key={token.symbol} className={selected === token.index ? "selected" : ""} onClick={() => onSelect(token.index)}><TokenLogo token={token} size={20} />{token.symbol}</button>)}</div>
      <p className="uni-list-label">Tokens</p>
      <div className="uni-token-list">
        {matches.length === 0 && <p className="uni-muted">No results found.</p>}
        {matches.map((token) => <button type="button" key={token.symbol} className={selected === token.index ? "uni-token-row selected" : "uni-token-row"} onClick={() => onSelect(token.index)}>
          <TokenLogo token={token} size={36} />
          <span className="uni-token-row-text"><strong>{token.name}</strong><span><span className="uni-token-row-symbol">{token.symbol}</span> <small>{token.address.slice(0, 6)}…{token.address.slice(-4)}</small></span></span>
          {balances && <span className="uni-token-row-balance"><strong>{formatUsd(balances[token.index], token.decimals)}</strong><small>{formatAmount(balances[token.index], token.decimals, 4)}</small></span>}
        </button>)}
      </div>
    </div>
  </>;
}

function ReviewModal({ sellToken, buyToken, quote, minOut, slippageBps, auto, execRate, onClose, onConfirm }: {
  sellToken: Token; buyToken: Token; quote: HookQuote; minOut: bigint; slippageBps: number; auto: boolean; execRate: number;
  onClose: () => void; onConfirm: (onStatus: (status: TxStatus, detail?: { hash?: Hash; message?: string }) => void) => Promise<boolean>;
}) {
  const { explorerTx, network } = useUni();
  const [status, setStatus] = useState<TxStatus | "review">("review");
  const [hash, setHash] = useState<Hash | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const confirm = () => void onConfirm((next, detail) => {
    setStatus(next);
    if (detail?.hash) setHash(detail.hash);
    if (detail?.message) setMessage(detail.message);
  });
  return <>
    <div className="uni-scrim" onClick={onClose} />
    <div className="uni-modal uni-review" role="dialog" aria-label="Review swap">
      <div className="uni-modal-head"><h2>{status === "review" ? "You're swapping" : status === "success" ? "Swap success!" : status === "failed" ? "Swap failed" : "Swapping"}</h2><button type="button" aria-label="Close" onClick={onClose}>×</button></div>
      <div className="uni-review-leg"><div><strong>{formatAmount(quote.amountIn, sellToken.decimals, 4)} {sellToken.symbol}</strong><small>{formatUsd(quote.amountIn, sellToken.decimals)}</small></div><TokenLogo token={sellToken} size={40} /></div>
      <div className="uni-review-arrow" aria-hidden="true">↓</div>
      <div className="uni-review-leg"><div><strong>{formatAmount(quote.amountOut, buyToken.decimals, 4)} {buyToken.symbol}</strong><small>{formatUsd(quote.amountOut, buyToken.decimals)}</small></div><TokenLogo token={buyToken} size={40} /></div>
      {status === "review" && <>
        <dl className="uni-details-body">
          <div><dt>Rate</dt><dd>1 {sellToken.symbol} = {execRate.toFixed(4)} {buyToken.symbol}</dd></div>
          <div><dt>Fee (0.05%)</dt><dd>{formatAmount(quote.fee, sellToken.decimals, 6)} {sellToken.symbol}</dd></div>
          <div><dt>Max slippage</dt><dd>{auto && <span className="uni-tag">Auto</span>} {slippageBps / 100}%</dd></div>
          <div><dt>Min. received</dt><dd>{formatAmount(minOut, buyToken.decimals, 4)} {buyToken.symbol}</dd></div>
          <div><dt>Network</dt><dd>{network.name}</dd></div>
        </dl>
        <button type="button" className="uni-main-button accent" onClick={confirm}>Swap</button>
      </>}
      {(status === "signing" || status === "pending") && <div className="uni-progress"><span className="uni-spinner" aria-hidden="true" /><p>{status === "signing" ? "Confirm swap in wallet" : "Swap submitted"}</p>{hash && <a href={explorerTx(hash)} target="_blank" rel="noreferrer">View on explorer ↗</a>}</div>}
      {status === "success" && <div className="uni-progress success"><span className="uni-check" aria-hidden="true">✓</span><p>Swapped {formatAmount(quote.amountIn, sellToken.decimals, 4)} {sellToken.symbol} for {buyToken.symbol}</p>{hash && <a href={explorerTx(hash)} target="_blank" rel="noreferrer">View on explorer ↗</a>}<button type="button" className="uni-main-button soft" onClick={onClose}>Close</button></div>}
      {status === "failed" && <div className="uni-progress failed"><span className="uni-check" aria-hidden="true">!</span><p>{message ?? "The swap failed."}</p><button type="button" className="uni-main-button soft" onClick={() => setStatus("review")}>Try again</button></div>}
    </div>
  </>;
}
