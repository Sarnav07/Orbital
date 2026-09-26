import { useState } from "react";
import { EXPLORER, LIVE_SWAP_TX } from "./chain/deployment";
import { NETWORKS, explorerAddressOn } from "./chain/networks";
import { createSandboxState, singleDepegTrapPrice } from "./simulator";
import { Orbs } from "./ui/Orbs";

type Go = (route: "home" | "docs" | "app") => void;

const REPO = "https://github.com/Sarnav07/Orbital/blob/main";
const COINS = ["USDC", "USDT", "DAI", "FRAX"] as const;

/** Sidebar structure: three chapter groups, each linking to a section id on this page. */
export const docsChapters = [
  { label: "Understand the protocol", links: [["overview", "Overview"], ["shared-book", "One book, six pools"], ["custody", "Where the tokens live"], ["curve", "The Orbital curve"]] },
  { label: "Use Orbital", links: [["swaps", "How a swap settles"], ["fees", "Fees & slippage"], ["liquidity", "Providing liquidity"], ["depegs", "When a coin depegs"]] },
  { label: "Go deeper", links: [["execution", "Under the hood"], ["contracts", "Deployed contracts"], ["questions", "Common questions"], ["glossary", "Glossary"], ["further-reading", "Further reading"]] },
] as const;

const ranges = createSandboxState().ticks.map((tick) => {
  const ratio = Number(tick.k * 1000n / tick.radius) / 1000;
  return { ratio, trap: singleDepegTrapPrice(ratio) };
});

function Contents() {
  return <nav aria-label="Documentation sections">{docsChapters.map((chapter) => <div className="dg-chapter" key={chapter.label}>
    <p>{chapter.label}</p>
    {chapter.links.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
  </div>)}</nav>;
}

// Four coins on the corners of the shared book; every pair is one canonical v4 pool.
const NODES = [{ x: 340, y: 46 }, { x: 604, y: 170 }, { x: 340, y: 294 }, { x: 76, y: 170 }];
const DIRECTIONS = COINS.flatMap((_, a) => COINS.map((__, b) => [a, b] as const)).filter(([a, b]) => a !== b);

export function PoolDiagram() {
  const [selected, setSelected] = useState(0);
  const [input, output] = DIRECTIONS[selected];
  const from = NODES[input];
  const to = NODES[output];
  const lerp = (t: number) => ({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
  const start = lerp(0.14);
  const end = lerp(0.84);
  return <figure className="dg-figure dg-pool-figure">
    <div className="dg-figure-head"><span>The deployed basket: four coins, six pools, twelve directions.</span><span>ONE RESERVE BOOK</span></div>
    <svg viewBox="0 0 680 340" role="img" aria-label={`${COINS[input]} goes into the shared reserve book and ${COINS[output]} comes out. Every pool advances the same book.`}>
      <defs><marker id="dg-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M1 1 9 5 1 9" fill="none" stroke="currentColor" strokeWidth="1.5" /></marker></defs>
      <ellipse cx="340" cy="170" rx="230" ry="140" fill="none" className="dg-faint" strokeDasharray="3 7" />
      {NODES.flatMap((a, i) => NODES.slice(i + 1).map((b, j) => <line key={`${i}-${i + j + 1}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="dg-edge" />))}
      <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} className="dg-active" markerEnd="url(#dg-arrow)" />
      <rect x="268" y="146" width="144" height="48" rx="10" className="dg-core" />
      <text x="340" y="165" textAnchor="middle" className="dg-core-text">Orbital hook</text>
      <text x="340" y="184" textAnchor="middle" className="dg-muted-text">one shared book</text>
      {NODES.map((node, index) => <g key={COINS[index]}>
        <circle cx={node.x} cy={node.y} r="24" className={index === input || index === output ? "dg-node active" : "dg-node"} />
        <text x={node.x} y={node.y + 4} textAnchor="middle" className="dg-node-text">{COINS[index]}</text>
      </g>)}
    </svg>
    <div className="dg-pair-controls"><label htmlFor="dg-direction">Explore a direction</label>
      <select id="dg-direction" value={selected} onChange={(event) => setSelected(Number(event.target.value))}>{DIRECTIONS.map(([a, b], index) => <option key={index} value={index}>{COINS[a]} → {COINS[b]}</option>)}</select>
    </div>
    <figcaption><p aria-live="polite"><strong>{COINS[input]} goes in. {COINS[output]} comes out.</strong> The next trade starts from the updated book, whichever pool it uses.</p><span>Routing illustration, not a price quote. The four coins are mock assets.</span></figcaption>
  </figure>;
}

export function DocsPage({ navigate }: { navigate: Go }) {
  const go = (route: "home" | "docs" | "app") => (event: { preventDefault(): void }) => { event.preventDefault(); navigate(route); };
  return <div className="dg">
    <aside className="dg-sidebar" aria-label="Guide navigation">
      <a href="/docs" className="dg-brand" onClick={go("docs")}>▤ Orbital Docs</a>
      <Contents />
      <div className="dg-sidebar-foot"><span className="dg-network-dot" />Live on 4 testnets<a href="/app" onClick={go("app")}>Open the app ↗</a></div>
    </aside>
    <div className="dg-reading">
      <div className="dg-breadcrumb"><a href="/" onClick={go("home")}>Orbital</a><span aria-hidden="true">›</span><span>Documentation</span></div>
      <details className="dg-mobile-contents"><summary>▤ In this guide</summary><Contents /></details>
      <article className="dg-article" aria-labelledby="docs-title">
        <header className="dg-intro" id="overview">
          <Orbs />
          <p className="dg-eyebrow">The protocol, explained</p>
          <h1 id="docs-title">How Orbital <em>works.</em></h1>
          <p className="dg-lead">n stablecoins. Every pair a Uniswap v4 pool. One reserve book underneath them.</p>
          <p>Orbital is a Uniswap v4 hook. Every pool it serves draws on the same n-asset reserve book, which is priced by Paradigm's n-dimensional Orbital geometry. The deployment described here is the live 4-coin book (USDC, USDT, DAI and FRAX across six pools), running as its own pool on Unichain Sepolia, Ethereum Sepolia, Arbitrum Sepolia and Arc Testnet. Liquidity providers choose a <a href="#glossary">range</a> that sets how tightly their capital concentrates around the peg. Traders swap through any pool, and the hook settles every trade inside the v4 PoolManager.</p>
          <div className="dg-thesis"><span aria-hidden="true">↗</span><p>The key idea: <strong>a pool is only an entry point. The liquidity is the shared book.</strong> A USDC/DAI trade and a USDT/FRAX trade move the same state.</p></div>
          <div className="dg-intro-links"><a href="#shared-book">Start with the idea →</a><a href="#swaps">Follow a swap →</a></div>
        </header>

        <section id="shared-book" aria-labelledby="shared-title">
          <p className="dg-label">The big picture</p><h2 id="shared-title">One book. <em>Every pool.</em></h2>
          <p>n stablecoins make n(n − 1)/2 pairs: six for four coins, twenty-eight for eight. A pair-per-pool design splits deposits that many ways, so each pool is shallower than the basket could be. Orbital registers every canonical pair pool against one hook and keeps a single n-asset reserve vector behind them. The deployed book has four coins, so it has six pools.</p>
          <p>A USDC → DAI swap changes what the book holds. A later FRAX → USDT swap starts from that updated state. Only the two coins in a trade move; the other two coordinates stay put.</p>
          <PoolDiagram />
        </section>

        <section id="custody" aria-labelledby="custody-title">
          <p className="dg-label">Custody</p><h2 id="custody-title">The PoolManager holds the tokens.<br /><em>The hook keeps the book.</em></h2>
          <p>Liquidity is not parked in a separate vault. The hook holds the basket as ERC-6909 claims inside Uniswap's PoolManager, the same custody layer every v4 pool uses. Liquidity providers hold <strong>shares of a range</strong>, recorded by the hook's fee book.</p>
          <div className="dg-custody">
            <div><h3>Trader's wallet</h3><p>Signs the swap.<br />Pays input, receives output.</p></div>
            <div className="dg-custody-middle"><span>One unlock</span><span className="dg-arrows" aria-hidden="true">⇄</span><small>PoolManager + router</small></div>
            <div><h3>Orbital hook</h3><p>Mints input claims.<br />Burns output claims.</p></div>
          </div>
          <p>Every transfer settles inside one PoolManager <code>unlock</code>. If anything is left unsettled, the whole transaction reverts. The hook's <code>solvency()</code> view shows that its claims cover every range's redeemable inventory plus unpaid fees, and a fuzzed invariant keeps that true across random trading.</p>
          <p className="dg-aside"><strong>Shares are claims, not fixed amounts.</strong> A range share is worth that range's current inventory. Trading changes the mix of coins behind it.</p>
        </section>

        <section id="curve" aria-labelledby="curve-title">
          <p className="dg-label">The pricing idea</p><h2 id="curve-title">Liquidity, concentrated<br /><em>around the peg.</em></h2>
          <p>Picture the book's reserves as a point on a curved n-dimensional surface, one axis per coin. A swap adds one coin and removes another, moving the point along the surface. The curve decides how much comes out; it does not promise a one-for-one exchange.</p>
          <figure className="dg-figure dg-curve-figure">
            <svg viewBox="0 0 370 250" role="img" aria-label="Nested range boundaries around the equal-price point. Narrower ranges concentrate liquidity more tightly.">
              <ellipse cx="185" cy="127" rx="160" ry="96" fill="none" className="dg-faint" />
              <ellipse cx="185" cy="127" rx="117" ry="68" className="dg-ring mid" />
              <ellipse cx="185" cy="127" rx="71" ry="39" className="dg-ring inner" />
              <path d="M25 127h320M185 31v192" className="dg-faint" strokeDasharray="3 6" />
              <circle cx="185" cy="127" r="5" className="dg-center" />
              <text x="185" y="243" textAnchor="middle" className="dg-muted-text">Equal-price point at the center</text>
            </svg>
            <figcaption><h3>Three deployed ranges</h3>
              {ranges.map((range, index) => <p key={index}><strong>Range {index + 1} · k/r {range.ratio.toFixed(3)}</strong>{range.trap === null ? " never traps on a single-coin depeg." : ` traps near $${range.trap.toFixed(2)} if one coin depegs.`}</p>)}
              <span>Conceptual view of nested boundaries, not a live price chart.</span>
            </figcaption>
          </figure>
          <p>Each nested region is a <strong>range</strong> (a tick). Narrow ranges hold far less real inventory for the same depth near the peg. When the book moves far enough, a range reaches its boundary and becomes <em>trapped</em>. The engine then recombines the ranges and continues the trade, up to eight crossings per swap.</p>
          <details><summary>A closer look at the curve</summary><div className="dg-details">
            <p>A single range is an n-dimensional sphere. With one coordinate per coin, its frontier satisfies:</p>
            <p className="dg-equation" aria-label="The sum over assets of radius minus reserve squared equals radius squared.">∑ (r − x<sub>i</sub>)<sup>2</sup> = r<sup>2</sup></p>
            <p>A range adds a boundary plane <code>α = k</code>. Interior ranges combine into one sphere, and boundary ranges add a fixed offset. Together they form a torus. The geometry holds for any n. The deployed hook fixes n = 4, so √n = 2 is exact in WAD fixed point. The <a href={`${REPO}/docs/MATH.md`} target="_blank" rel="noreferrer">mathematical contract</a> derives each step, and the <a href="https://www.paradigm.xyz/writing/orbital" target="_blank" rel="noreferrer">Orbital paper</a> develops the geometry.</p>
          </div></details>
        </section>

        <section id="swaps" aria-labelledby="swaps-title">
          <p className="dg-label">For traders</p><h2 id="swaps-title">From quote <em>to settlement.</em></h2>
          <p>You choose an exact input amount. The app reads the live book and runs the same arithmetic as the hook, so the quote equals what the hook will pay if nothing trades first. The transaction carries the limits that protect you if something does.</p>
          <ol className="dg-steps">
            <li><div><h3>Choose coins and get a quote</h3><p>Pick what to pay and what to receive. The quote shows the output, the fee and the minimum you will accept.</p></div></li>
            <li><div><h3>Approve the input, if needed</h3><p>A token approval lets the router spend your input. It is a separate transaction and does not execute the trade.</p></div></li>
            <li><div><h3>Swap with a minimum and a deadline</h3><p>The app encodes <code>minAmountOut</code> and a deadline as hook data and simulates the call before your wallet signs.</p></div></li>
            <li><div><h3>The hook settles in the PoolManager</h3><p><code>beforeSwap</code> charges the fee, prices the trade across any range crossings, takes your input as claims and pays your output. If a check fails, the transaction reverts.</p></div></li>
          </ol>
          <a className="dg-text-link" href="/app" onClick={go("app")}>Try a swap →</a>
        </section>

        <section id="fees" aria-labelledby="fees-title">
          <p className="dg-label">Understanding your quote</p><h2 id="fees-title">A fee, a price,<br />and <em>your minimum.</em></h2>
          <p>The pool fee is <strong>0.05%</strong>, fixed at deployment. It is charged once on the gross input, even when a trade crosses several ranges. The rest of the input is priced by the curve.</p>
          <div className="dg-fee-example" aria-label="Fee example: 1,000 USDC input at a 0.05 percent fee">
            <p>Example · the recorded live swap</p>
            <dl><div><dt>You send</dt><dd>1,000.00 <small>USDC</small></dd></div><div><dt>Fee</dt><dd>0.50 <small>USDC</small></dd></div><div><dt>You receive</dt><dd>999.4334 <small>DAI</small></dd></div></dl>
            <span>999.50 USDC is priced by the curve; the difference is price impact. <a href={`${EXPLORER}/tx/${LIVE_SWAP_TX}`} target="_blank" rel="noreferrer">View the transaction ↗</a></span>
          </div>
          <div className="dg-definitions">
            <div><h3>Price impact</h3><p>The price moves as you trade against a finite book. Larger trades move further along the curve, and may cross range boundaries.</p></div>
            <div><h3>Slippage tolerance</h3><p>How much movement you accept between quote and execution. It sets your minimum output; it is not a fee.</p></div>
            <div><h3>Network gas</h3><p>Paid in the network's native token: ETH on Unichain Sepolia, Ethereum Sepolia and Arbitrum Sepolia, USDC on Arc. An ordinary swap costs about 1.2M gas, and more when ranges are crossed.</p></div>
          </div>
          <details><summary>How fees, decimals and minimums are rounded</summary><div className="dg-details">
            <p>Fees use parts per million and round up in the input token's smallest unit. Output rounds down in the output token's smallest unit:</p>
            <pre><code>{"fee      = ceil(amount in × 500 / 1,000,000)\nnet      = (amount in − fee) × 10^(18 − decimals in)\noutput   = floor(curve(net) / 10^(18 − decimals out))\nminimum  = floor(output × (10,000 − slippage bps) / 10,000)"}</code></pre>
            <p>USDC and USDT use 6 decimals; DAI and FRAX use 18. The fraction of a unit left over stays in the book as non-redeemable dust.</p>
          </div></details>
        </section>

        <section id="liquidity" aria-labelledby="liquidity-title">
          <p className="dg-label">For liquidity providers</p><h2 id="liquidity-title">Pick a range.<br /><em>Own its share.</em></h2>
          <p>Liquidity goes to one range. You buy shares of it by depositing that range's current basket of all four coins, in the exact amounts the hook previews. Native v4 liquidity positions are rejected on these pools.</p>
          <div className="dg-lifecycle" aria-label="Liquidity sequence"><span>Approve</span><span aria-hidden="true">→</span><span>Preview</span><span aria-hidden="true">→</span><span>Add liquidity</span><span aria-hidden="true">→</span><span>Collect / remove</span></div>
          <p>Each swap's fee is shared by the ranges that were earning when it started, in proportion to their size, and tracked per share. New shares cannot claim earlier fees. You can collect fees at any time, and you can remove liquidity for that range's current inventory. Rounding always favours the pool, by at most a few units.</p>
          <p className="dg-aside"><strong>Concentration changes your exposure.</strong> A narrow range earns more of the trading near the peg, but if a coin depegs it can end up holding more of the weak coin. A range is not a guaranteed dollar floor or return.</p>
          <a className="dg-text-link" href="/app" onClick={go("app")}>Explore liquidity →</a>
        </section>

        <section id="depegs" aria-labelledby="depegs-title">
          <p className="dg-label">Stress</p><h2 id="depegs-title">When one coin <em>breaks.</em></h2>
          <p>If a coin loses its peg, traders sell it into the book. As they do, narrow ranges reach their boundary first. A trapped range stops taking in the failing coin, which caps its exposure, while wider ranges keep trading.</p>
          <div className="dg-definitions">{ranges.map((range, index) => <div key={index}><h3>Range {index + 1} · k/r {range.ratio.toFixed(3)}</h3><p>{range.trap === null ? "Never traps on a single-coin depeg." : `Traps near $${range.trap.toFixed(2)} for a single-coin depeg.`}</p></div>)}</div>
          <p>If a trade would trap every range at once, the prototype reverts it rather than guess. The Sandbox's <a href="/app" onClick={go("app")}>depeg stress model</a> walks through this step by step on the deployed parameters.</p>
        </section>

        <section id="execution" aria-labelledby="execution-title">
          <p className="dg-label">The pieces, connected</p><h2 id="execution-title">What runs <em>underneath.</em></h2>
          <div className="dg-definitions">
            <div><h3>OrbitalV4Hook</h3><p>Pool gating, decimals, fees, settlement, range liquidity and the solvency view.</p></div>
            <div><h3>PoolManager</h3><p>Uniswap v4's singleton: custody as ERC-6909 claims, and atomic settlement inside <code>unlock</code>.</p></div>
            <div><h3>Sphere4 · Torus4 · SegmentedTorus4</h3><p>Range geometry, the fixed-partition solver and the crossing engine.</p></div>
            <div><h3>RangeFeeBook4</h3><p>Range shares and per-share fee growth, controlled by the hook.</p></div>
            <div><h3>Unichain Sepolia</h3><p>The testnet where the hook and pools are deployed.</p></div>
          </div>
          <details><summary>The four hook permissions</summary><div className="dg-details">
            <div className="dg-opcodes">
              <div><code>1&lt;&lt;13</code><h3>beforeInitialize</h3><p>Admits only the six canonical pool keys.</p></div>
              <div><code>1&lt;&lt;11</code><h3>beforeAddLiquidity</h3><p>Rejects native v4 positions.</p></div>
              <div><code>1&lt;&lt;7</code><h3>beforeSwap</h3><p>Prices and settles the trade.</p></div>
              <div><code>1&lt;&lt;3</code><h3>beforeSwapReturnDelta</h3><p>Replaces the pool's own swap with the hook's result.</p></div>
            </div>
            <pre><code>{"hook address ends in 0x…2888\nhookData = abi.encode(uint256 minAmountOut, uint256 deadline)"}</code></pre>
            <p>The design is n-asset. The deployed hook supports four coins, up to 16 ranges, at most 8 range crossings per swap, and exact-input swaps only.</p>
          </div></details>
        </section>

        <section id="contracts" aria-labelledby="contracts-title">
          <p className="dg-label">On-chain</p><h2 id="contracts-title">Deployed <em>contracts.</em></h2>
          <p>The same four-coin pool runs independently on four testnets; each has its own hook, router and mock tokens. Every contract has published source.</p>
          {NETWORKS.map((network) => {
            const deployment = network.deployment;
            const address = (value: string) => explorerAddressOn(network, value);
            return <div className="dg-network-block" key={network.key}>
              <h3><img src={network.icon} alt="" />{network.name} <small>chain {deployment.chainId}</small></h3>
              <dl className="dg-glossary dg-contracts">
                <div><dt>OrbitalV4Hook</dt><dd><a href={address(deployment.hook)} target="_blank" rel="noreferrer">{deployment.hook}</a></dd></div>
                <div><dt>Swap router</dt><dd><a href={address(deployment.router)} target="_blank" rel="noreferrer">{deployment.router}</a></dd></div>
                <div><dt>PoolManager</dt><dd><a href={address(deployment.poolManager)} target="_blank" rel="noreferrer">{deployment.poolManager}</a></dd></div>
                {deployment.currencies.map((currency, index) => <div key={currency}><dt>{deployment.symbols[index]} · {deployment.decimals[index]} decimals</dt><dd><a href={address(currency)} target="_blank" rel="noreferrer">{currency}</a></dd></div>)}
              </dl>
              {network.key === "arc-testnet" && <p className="dg-note">Arc's PoolManager runs code byte-identical to Uniswap's v4 PoolManager on the other three testnets, but its owner differs from theirs, so it cannot be proven to be Uniswap's own deployment. Its owner can only switch on protocol fees, which are off.</p>}
            </div>;
          })}
        </section>

        <section id="questions" aria-labelledby="questions-title">
          <p className="dg-label">A few useful answers</p><h2 id="questions-title">Before you <em>begin.</em></h2>
          <div className="dg-questions">
            <details><summary>Do I need a wallet to read or explore?</summary><div className="dg-details"><p>No. This guide, the live book and the sandbox work without connecting. Connect a browser wallet to swap, add liquidity or collect fees.</p></div></details>
            <details><summary>Why are approval and swap separate confirmations?</summary><div className="dg-details"><p>An approval changes how much a contract may spend. The swap is a separate transaction that actually exchanges coins. An existing allowance skips the approval.</p></div></details>
            <details><summary>Why can a quote fail or a swap revert?</summary><div className="dg-details"><p>The book may have moved past your minimum, the deadline may have passed, or the trade may be too large: it could trap every range or need more than eight crossings. The app explains the reason before you sign.</p></div></details>
            <details><summary>Are these real stablecoins?</summary><div className="dg-details"><p>No. They are mock tokens with a public mint and no value. Gas is paid in the network's native token (testnet ETH, or USDC on Arc from faucet.circle.com), available from public faucets.</p></div></details>
            <details><summary>Has this been audited?</summary><div className="dg-details"><p>No. It is an unaudited prototype. Static analysis findings are triaged in the repository, and the known limits are listed in the implementation ledger.</p></div></details>
          </div>
        </section>

        <section id="glossary" aria-labelledby="glossary-title">
          <p className="dg-label">Keep the vocabulary simple</p><h2 id="glossary-title">A small <em>glossary.</em></h2>
          <dl className="dg-glossary">
            <div><dt>Reserve book</dt><dd>The single n-coin state behind every pair pool (four coins and six pools in the deployment).</dd></div>
            <div><dt>Range</dt><dd>A liquidity component (a tick) with its own radius and boundary, identified by k/r.</dd></div>
            <div><dt>Interior / boundary</dt><dd>An interior range trades normally. A boundary range is trapped at its edge until the book moves back.</dd></div>
            <div><dt>Virtual offset</dt><dd>The part of a range's coordinate that is never redeemable; it is what makes concentration possible.</dd></div>
            <div><dt>Real inventory</dt><dd>The tokens a range's shares can actually withdraw.</dd></div>
            <div><dt>Claims</dt><dd>ERC-6909 balances inside the PoolManager; the hook's custody.</dd></div>
            <div><dt>BeforeSwapDelta</dt><dd>What the hook returns to v4 so its own price replaces the pool's swap.</dd></div>
          </dl>
        </section>

        <section id="further-reading" aria-labelledby="reading-title">
          <p className="dg-label">Keep exploring</p><h2 id="reading-title">From idea <em>to evidence.</em></h2>
          <div className="dg-reading-links">
            <a href="https://www.paradigm.xyz/writing/orbital" target="_blank" rel="noreferrer"><span><strong>The Orbital paper</strong><small>The original geometric model by Dan Robinson, Ciamac Moallemi and Dave White.</small></span>↗</a>
            <a href={`${REPO}/docs/MATH.md`} target="_blank" rel="noreferrer"><span><strong>Mathematical contract</strong><small>Every equation the hook implements, with requirement IDs.</small></span>↗</a>
            <a href={`${REPO}/docs/PAPER_IMPLEMENTATION.md`} target="_blank" rel="noreferrer"><span><strong>Paper-to-implementation ledger</strong><small>Where each mechanism lives, what proves it, and what is still open.</small></span>↗</a>
            <a href={`${REPO}/docs/TESTS.md`} target="_blank" rel="noreferrer"><span><strong>Acceptance tests</strong><small>Every case ID mapped to the test that runs it.</small></span>↗</a>
          </div>
          <div className="dg-end"><span>You've got the idea. See it in action.</span><a href="/app" onClick={go("app")}>Open the app →</a><a href="#overview">Back to top ↑</a></div>
        </section>
      </article>
    </div>
  </div>;
}
