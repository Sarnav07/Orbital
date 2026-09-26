import { useUni } from "./state";
import { type Token, formatAmount, formatUsd, shortAddress } from "./tokens";

/** Sum of token amounts valued at $1 each (the agreed convention for the mock basket). */
const usdTotal = (tokens: Token[], amounts: bigint[]) => formatUsd(amounts.reduce((sum, amount, index) => sum + amount * 10n ** BigInt(18 - tokens[index].decimals), 0n), 18);

export function ExplorePage() {
  const { tokens, network, explorerAddress, explorerTx, book, swaps, swapsOk, swapsLoaded, blockNumber } = useUni();
  return <section className="uni-page">
    <div className="uni-page-head"><h1>Explore</h1><span className="uni-muted">{blockNumber ? `Block ${blockNumber.toLocaleString()}` : "Connecting…"} · {network.name}</span></div>

    <div className="uni-stats">
      <div className="uni-stat"><span>Total held by the hook</span><strong>{book ? usdTotal(tokens, book.custody) : "—"}</strong><small>PoolManager claims, $1 per mock token</small></div>
      <div className="uni-stat"><span>Solvency</span><strong className={book && !book.solvent ? "bad" : "good"}>{book ? (book.solvent ? "Covered" : "Check") : "—"}</strong><small>Held claims vs redeemable inventory + unpaid fees</small></div>
      <div className="uni-stat"><span>Ranges in range</span><strong>{book ? `${book.ticks.filter((tick) => tick.isInterior).length} / ${book.ticks.length}` : "—"}</strong><small>Interior ranges earn fees</small></div>
      <div className="uni-stat"><span>Unpaid fees</span><strong>{book ? usdTotal(tokens, book.feeLiability) : "—"}</strong><small>Owed to LPs, collectable anytime</small></div>
    </div>

    <h2 className="uni-section-title">Tokens</h2>
    <div className="uni-table uni-token-table" role="table" aria-label="Tokens held by the book">
      <div role="row" className="uni-table-head"><span>#</span><span>Token</span><span>Held</span><span>Value</span><span>Contract</span></div>
      {tokens.map((token, position) => <div role="row" key={token.symbol}>
        <span>{position + 1}</span>
        <span className="uni-table-token"><img src={token.logo} alt="" /><strong>{token.name}</strong><small>{token.symbol}</small></span>
        <span>{book ? formatAmount(book.custody[token.index], token.decimals, 2) : "—"}</span>
        <span>{book ? formatUsd(book.custody[token.index], token.decimals) : "—"}</span>
        <span><a href={explorerAddress(token.address)} target="_blank" rel="noreferrer">{shortAddress(token.address)} ↗</a></span>
      </div>)}
    </div>

    <h2 className="uni-section-title">Transactions</h2>
    <div className="uni-table uni-tx-table" role="table" aria-label="Recent swaps">
      <div role="row" className="uni-table-head"><span>Block</span><span>Type</span><span>Sold</span><span>Bought</span><span>Tx</span></div>
      {!swapsLoaded && <p className="uni-muted uni-table-note">Loading swap history…</p>}
      {swapsLoaded && !swapsOk && <p className="uni-muted uni-table-note">Swap history is unavailable from this RPC right now.</p>}
      {swapsLoaded && swapsOk && swaps.length === 0 && <p className="uni-muted uni-table-note">No swaps yet.</p>}
      {swaps.map((swap) => {
        const sold = tokens[swap.input];
        const bought = tokens[swap.output];
        return <div role="row" key={`${swap.hash}-${swap.input}-${swap.amountIn}`}>
          <span>{swap.blockNumber.toLocaleString()}</span>
          <span>Swap {sold?.symbol} for {bought?.symbol}</span>
          <span className="uni-table-token"><img src={sold?.logo} alt="" />{sold ? formatAmount(swap.amountIn, sold.decimals, 2) : ""} {sold?.symbol}</span>
          <span className="uni-table-token"><img src={bought?.logo} alt="" />{bought ? formatAmount(swap.amountOut, bought.decimals, 2) : ""} {bought?.symbol}</span>
          <span><a href={explorerTx(swap.hash)} target="_blank" rel="noreferrer">{shortAddress(swap.hash)} ↗</a></span>
        </div>;
      })}
    </div>

    <h2 className="uni-section-title">Contracts</h2>
    <div className="uni-table uni-contract-table" role="table" aria-label="Deployed contracts">
      {[["Orbital hook", network.deployment.hook], ["Swap router", network.deployment.router], ["PoolManager", network.deployment.poolManager]].map(([label, address]) => <div role="row" key={label}><span>{label}</span><span><a href={explorerAddress(address)} target="_blank" rel="noreferrer">{address} ↗</a></span></div>)}
    </div>
  </section>;
}
