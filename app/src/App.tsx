import { Fragment, Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react";
import { replay } from "../../packages/simulator/src/replay.js";
import fixture from "../../packages/fixtures/segmented-wad-v1.json";
import { DEPLOYMENT as deployment, EXPLORER, LIVE_SWAP_TX } from "./chain/deployment";
import {
  commitPreview,
  createSandboxState,
  depegStress,
  effectiveRate as rateFor,
  formatWad,
  interiorBitmap as bitmapForTicks,
  maxQuotableInput,
  parseWad,
  previewSwap,
  projectReserveImbalance,
  quoteMessage,
  sampleCurve,
  simulatorAssets,
  singleDepegTrapPrice,
  type CurvePoint,
  type QuotePreview,
  type Tick,
} from "./simulator";

const assets = ["USDC", "USDT", "DAI", "FRAX"];
const manifesto = "Stablecoins share a peg, but pair pools split their liquidity. Orbital gives the basket one reserve surface, then lets each LP choose how tightly to concentrate around the dollar.";

const principles = [
  ["01 · Reserve book", "Four assets, one state.", "Every canonical pair route advances the same four-asset reserve vector. Pair interfaces do not own separate liquidity.", "book"],
  ["02 · Geometry", "Sphere meets torus.", "Orbital pricing uses bounded four-asset sphere and torus geometry instead of v4’s native concentrated-liquidity curve.", "geometry"],
  ["03 · LP ranges", "Concentrate by range.", "LPs hold shares in a selected range. Each range tracks its own attributed inventory and virtual offset.", "range"],
  ["04 · Tick transitions", "Model the crossing.", "The quote engine tracks bounded tick transitions and recovery states instead of hiding changes at a range boundary.", "ticks"],
  ["05 · Attribution", "Positions stay local.", "Range shares are claims on that range’s attributed inventory. Fee checkpoints stay separate from principal accounting.", "shares"],
  ["06 · Verification", "Replay every transition.", "A dependency-free BigInt replayer checks a versioned crossing trace without floating-point arithmetic.", "replay"],
] as const;

export const problemCards = [
  ["01 / FRAGMENTATION", "4 COINS → 6 POOLS", "Fragmented", "N(N − 1) / 2 markets", "One basket, split across six order books.", "Pools are built two tokens at a time, so a four-coin basket needs six of them. The same deposits are divided across every combination, each pool ends up shallower than the last, and adding a fifth coin means standing up four more markets.", [["A", "A USDC/FRAX trade cannot touch USDC/USDT depth"], ["B", "Per-pool depth falls as the basket grows"], ["C", "Every new stablecoin needs its own set of markets"]]],
  ["02 / DENSITY", "STABLESWAP · V3 PAIRS", "Flat", "Σx ⟷ Πx", "Depth spread across prices a dollar never reaches.", "Curve's StableSwap holds many stablecoins together by blending constant-sum and constant-product pricing, but every LP shares one curve and cannot choose how tightly to concentrate. Uniswap v3 lets LPs choose a band, then caps them at two tokens. Today you pick breadth or depth, never both.", [["A", "Curve: the whole basket, thin at the peg"], ["B", "Uniswap v3: dense at the peg, one pair only"], ["C", "Idle capital earns nothing and cushions nothing"]]],
  ["03 / TAIL RISK", "USDC → $0.88 · MAR 2023", "Fragile", "pᵢ → 0  ⇒  x̄ → xᵢ", "One broken coin becomes the entire pool.", "A flat pool can keep quoting the failing asset near a dollar after the market has stopped. Arbitrage sells it in and takes the healthy coins out, until LPs hold little else. This is tail impermanent loss in an unbounded stablecoin pool.", [["A", "The pool prices the depeg last, not first"], ["B", "LPs absorb the fall with no bound of their own"], ["C", "USDC after SVB: flat pools took the loss"]]],
] as const;

export const geometryCards = [
  ["01 / SPHERE", "FOUR-ASSET RESERVE SURFACE", "Reserves live on one four-asset sphere.", "Σ(r − xᵢ)² = r²", "All four mock assets share one surface. At its centre, every supported pair trades 1:1; the curve bends only as the basket moves away from the peg."],
  ["02 / TICKS", "BOUNDED LP RANGE", "Each LP picks a plane: its range.", "kₘᵢₙ ≤ α ≤ kₘₐₓ", "A tick plane cuts the shared sphere at a selected bound. The range records its virtual offset and attributed inventory while interior and boundary states remain explicit."],
  ["03 / TORUS", "BOUNDED TRANSITIONS", "Interior and boundary ranges form one torus.", "(α − kᵦ − 2rᵢ)² + (‖w‖ − sᵦ)² = rᵢ²", "The bounded Torus4 solver combines the interior and boundary aggregates, then advances through recorded crossings. The prototype accepts up to 16 ranges and 8 status transitions per swap."],
] as const;

const geometryStatement = "The curve is built from three shapes. A sphere holds the reserves. A plane marks each LP's range. A torus folds the active ranges together.";

export const homePrinciples = [
  ["A", "Shared route state", "One canonical pair route updates the same four-asset reserve vector observed by the other supported routes.", "Pair interfaces are not separately funded reserve pools."],
  ["B", "Range-specific claims", "LP shares refer to one normalized range and the attributed inventory of that range—not a global pro-rata claim over every exposure.", "Virtual offsets are mathematical bounds, not redeemable LP inventory."],
  ["C", "Observed transitions", "The segmented engine identifies crossed tick boundaries, records status changes, and can replay the committed transition trace using BigInt arithmetic.", "The trace is an offline model fixture, not a live settlement feed."],
] as const;

export const chapters = [
  ["01 / 06", "The split", "Four stablecoins create six pair interfaces. When every interface holds separate reserves, liquidity is divided before a trade even begins.", "FRAGMENTED ROUTES"],
  ["02 / 06", "One reserve book", "Orbital routes the canonical pairs through one four-asset reserve vector. A trade on one interface changes the same state seen by every other interface.", "SHARED VECTOR"],
  ["03 / 06", "A bounded surface", "The prototype composes four-asset sphere and torus geometry. The state remains bounded instead of falling back to v4’s native concentrated-liquidity curve.", "SPHERE4 + TORUS4"],
  ["04 / 06", "Ranges hold their own claims", "LPs choose a range around the peg. That range keeps attributed inventory, LP shares, and its virtual offset separate from its neighbours.", "RANGE ACCOUNTING"],
  ["05 / 06", "Show the boundary", "Crossing ticks is explicit state, not a hidden edge case. The committed WAD fixture records trap and recovery transitions for offline replay.", "VERSIONED TRACE"],
  ["06 / 06", "Settle at the hook", "The hook takes each exact-input route as PoolManager claims, pays the output from the shared book, and returns the v4 custom delta. Ranges enter and exit through the hook, never native v4 positions.", "BEFORESWAP DELTA"],
] as const;

const explorerAddress = (address: string) => ({ address, href: `${EXPLORER}/address/${address}` });
// viem and the wallet flow load only when someone opens the testnet tab.
const LiveApp = lazy(() => import("./LiveApp").then((module) => ({ default: module.LiveApp })));

/** The recorded Unichain Sepolia deployment (contracts/deployments/unichain-sepolia.json). */
export const liveDeployment = {
  chainId: deployment.chainId,
  hook: explorerAddress(deployment.hook),
  router: explorerAddress(deployment.router),
  poolManager: explorerAddress(deployment.poolManager),
  tokens: deployment.currencies.map((address, index) => ({ symbol: deployment.symbols[index], decimals: deployment.decimals[index], ...explorerAddress(address) })),
  swapTx: { hash: LIVE_SWAP_TX, href: `${EXPLORER}/tx/${LIVE_SWAP_TX}` },
};

const shortHex = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;

function LiveDeployment() {
  return <section className="live-deployment" aria-labelledby="live-deployment-title"><div><p className="section-index">UNICHAIN SEPOLIA · CHAIN {liveDeployment.chainId}</p><h3 id="live-deployment-title">Deployed contracts.</h3><p>Mock basket, unaudited prototype. The testnet tab trades these contracts; the sandbox models the same ranges and fee locally.</p><a className="button button-light" href={liveDeployment.swapTx.href} target="_blank" rel="noreferrer">View a live swap ↗</a></div><dl>
    <dt>OrbitalV4Hook</dt><dd><a href={liveDeployment.hook.href} target="_blank" rel="noreferrer">{shortHex(liveDeployment.hook.address)}</a></dd>
    <dt>Swap router</dt><dd><a href={liveDeployment.router.href} target="_blank" rel="noreferrer">{shortHex(liveDeployment.router.address)}</a></dd>
    <dt>PoolManager</dt><dd><a href={liveDeployment.poolManager.href} target="_blank" rel="noreferrer">{shortHex(liveDeployment.poolManager.address)}</a></dd>
    {liveDeployment.tokens.map((token) => <Fragment key={token.symbol}><dt>{token.symbol} · {token.decimals}d</dt><dd><a href={token.href} target="_blank" rel="noreferrer">{shortHex(token.address)}</a></dd></Fragment>)}
  </dl></section>;
}

export const heroTitle = "One reserve book for four stablecoins.";

type Route = "home" | "docs" | "app";
type Navigate = (route: Route, hash?: string) => void;

const PRELOADER_KEY = "orbital:preloader-seen";

/** True only on the first call in a browser session; storage failures skip the preloader. */
export function shouldShowPreloader(storage: Pick<Storage, "getItem" | "setItem"> | null): boolean {
  if (!storage) return false;
  try {
    if (storage.getItem(PRELOADER_KEY)) return false;
    storage.setItem(PRELOADER_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

const sessionStore = () => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

// Evaluated once per page load so StrictMode double renders cannot hide it.
const firstVisit = typeof window !== "undefined" && shouldShowPreloader(sessionStore());

function useRoute(): [Route, Navigate] {
  const getRoute = () => {
    const path = location.pathname.replace(/\/+$/, "");
    return path === "/docs" ? "docs" : path === "/app" ? "app" : "home";
  };
  const [route, setRoute] = useState<Route>(getRoute);
  useEffect(() => {
    const onPopState = () => setRoute(getRoute());
    addEventListener("popstate", onPopState);
    return () => removeEventListener("popstate", onPopState);
  }, []);
  const navigate: Navigate = (next, hash) => {
    const target = next === "docs" ? "/docs" : next === "app" ? "/app" : "/";
    if (location.pathname !== target) history.pushState({}, "", target);
    setRoute(next);
    if (!hash) {
      requestAnimationFrame(() => scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }));
      return;
    }
    // The target section mounts after the route transition; retry for a short while.
    let attempts = 0;
    const scrollToHash = () => {
      const section = document.getElementById(hash);
      if (section) section.scrollIntoView({ behavior: "smooth" });
      else if (++attempts < 60) requestAnimationFrame(scrollToHash);
    };
    requestAnimationFrame(scrollToHash);
  };
  return [route, navigate];
}

function OrbitalMark() {
  return <span className="orbital-mark" aria-hidden="true"><i /><i /><i /><b /></span>;
}

function Preloader({ done }: { done: () => void }) {
  const reduced = useReducedMotion();
  useEffect(() => {
    const timeout = window.setTimeout(done, reduced ? 80 : 3400);
    return () => clearTimeout(timeout);
  }, [done, reduced]);
  return <motion.div className="preloader" exit={{ opacity: 0 }} transition={{ duration: 0.35 }}>
    <div className="preloader-grid" />
    <div className="preloader-content"><OrbitalMark /><p>WELCOME TO ORBITAL</p><span>INITIALIZING SHARED RESERVE GEOMETRY</span></div>
  </motion.div>;
}

function Nav({ route, navigate }: { route: Route; navigate: Navigate }) {
  const [open, setOpen] = useState(false);
  return <header className="nav-shell">
    <a className="brand" href="/" onClick={(event) => { event.preventDefault(); navigate("home"); }}><OrbitalMark /><span>orbital</span></a>
    <button className="menu-button" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>Menu</button>
    <nav className={open ? "nav-links is-open" : "nav-links"} aria-label="Primary navigation">
      <a href="/#protocol" onClick={(event) => { if (route !== "home") { event.preventDefault(); navigate("home", "protocol"); } setOpen(false); }}>protocol</a>
      <a href="/app" onClick={(event) => { event.preventDefault(); navigate("app"); setOpen(false); }}>simulator</a>
      <a href="/docs" aria-current={route === "docs" ? "page" : undefined} onClick={(event) => { event.preventDefault(); navigate("docs"); setOpen(false); }}>docs</a>
      <a href="https://www.paradigm.xyz/writing/orbital" target="_blank" rel="noreferrer">paper ↗</a>
    </nav>
    <a className="nav-cta" href="/app" onClick={(event) => { event.preventDefault(); navigate("app"); }}>Launch App</a>
  </header>;
}

function HeroOrbital() {
  const reduced = useReducedMotion();
  return <motion.div className="hero-orbital" animate={reduced ? {} : { rotate: 360 }} transition={{ repeat: Infinity, ease: "linear", duration: 34 }} aria-hidden="true">
    <span className="orbital-ring ring-one" /><span className="orbital-ring ring-two" /><span className="orbital-ring ring-three" />
    <span className="orbital-core" />
    {assets.map((asset, index) => <span className={`orbital-node node-${index + 1}`} key={asset}><i />{asset}</span>)}
  </motion.div>;
}

function Hero({ navigate }: { navigate: Navigate }) {
  return <section className="hero" id="top">
    <div className="hero-mesh" aria-hidden="true" />
    <HeroOrbital />
    <div className="hero-content">
      <p className="eyebrow"><b /> EXPERIMENTAL UNISWAP V4 HOOK <span>·</span> SHARED STABLECOIN LIQUIDITY</p>
      <h1>{heroTitle}</h1>
      <p>Four assets. Six pair interfaces. One shared reserve book shaped by Orbital geometry.</p>
      <div className="hero-actions"><a className="button button-solid" href="#protocol">Explore Protocol</a><a className="underlink" href="/docs" onClick={(event) => { event.preventDefault(); navigate("docs"); }}>Read the story</a></div>
    </div>
    <div className="scroll-cue"><span>scroll</span><i /></div>
  </section>;
}

function RevealedWord({ word, index, total, progress }: { word: string; index: number; total: number; progress: MotionValue<number> }) {
  const start = index / total;
  const opacity = useTransform(progress, [start, Math.min(1, start + .07)], [.14, 1]);
  return <motion.span style={{ opacity }}>{word}{" "}</motion.span>;
}

function Manifesto() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const words = manifesto.split(" ");
  return <section ref={ref} className="manifesto" aria-labelledby="thesis-title"><div className="manifesto-sticky">
    <div className="manifesto-copy"><p className="section-index">/ 01 · The thesis</p><p id="thesis-title" className="manifesto-text">{words.map((word, index) => <RevealedWord key={`${word}-${index}`} word={word} index={index} total={words.length} progress={scrollYProgress} />)}</p></div>
  </div></section>;
}

function Problem() {
  return <section className="problem-section" id="problem" aria-labelledby="problem-title">
    <div className="problem-heading"><p className="section-index">/ 02 · The problem</p><h2 id="problem-title">Stablecoins share a peg. <em>Pair pools split the state.</em></h2><p>Orbital starts from a narrow prototype question: can four stablecoins expose six canonical pair routes while advancing one shared reserve book?</p></div>
    <div className="problem-grid">{problemCards.map(([index, metric, title, equation, lead, text, insights]) => <motion.article className="problem-card" key={index} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }} transition={{ duration: .55 }}><div className="card-rule"><span>{index}</span><b>{metric}</b></div><h3>{title}</h3><div className="equation" aria-hidden="true">{equation}</div><p className="problem-lead">{lead}</p><p className="problem-copy">{text}</p><ul className="card-insights">{insights.map(([letter, detail]) => <li key={letter}><b>{letter}</b><span>{detail}</span></li>)}</ul></motion.article>)}</div>
  </section>;
}

function Geometry() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 78%", "end 48%"] });
  const words = geometryStatement.split(" ");
  return <section ref={ref} className="geometry-section" id="geometry" aria-labelledby="geometry-title"><div className="geometry-heading"><p className="section-index">/ 03 · Mechanics</p></div><div className="geometry-statement"><h2 id="geometry-title">{words.map((word, index) => <RevealedWord key={`${word}-${index}`} word={word} index={index} total={words.length} progress={scrollYProgress} />)}</h2></div><div className="geometry-grid">{geometryCards.map(([index, metric, title, equation, text]) => <motion.article className="geometry-panel" key={index} initial={{ opacity: 0, y: 22 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }} transition={{ duration: .55 }}><div className="card-rule"><span>{index}</span><b>{metric}</b></div><h3>{title}</h3><div className="equation equation-large" aria-hidden="true">{equation}</div><p>{text}</p></motion.article>)}</div></section>;
}

function HomePrinciples() {
  return <section className="home-principles" id="principles" aria-labelledby="principles-title"><div className="principles-intro"><p className="section-index">/ 04 · Principles</p><h2 id="principles-title">Three rules make the <em>prototype legible.</em></h2><p>Shared state, range-local claims, and recorded transitions give every supported route the same accounting surface without hiding the current implementation boundary.</p></div><div className="principles-rows">{homePrinciples.map(([letter, title, text, note]) => <motion.article className="principle-row" key={letter} initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true, margin: "-80px" }} transition={{ duration: .55 }}><span>{letter}</span><h3>{title}</h3><div><p>{text}</p><small>{note}</small></div></motion.article>)}</div></section>;
}

function CardVisual({ variant }: { variant: string }) {
  if (variant === "book") return <div className="book-visual" aria-hidden="true">{assets.map((asset) => <span key={asset}>{asset}</span>)}<b>ONE<br />BOOK</b></div>;
  if (variant === "geometry") return <div className="geometry-visual" aria-hidden="true"><i /><i /><i /><b>SPHERE4</b><span>TORUS4</span></div>;
  if (variant === "range") return <div className="range-visual" aria-hidden="true"><i /><i /><b>PEG RANGE</b><span>LP BOUND</span></div>;
  if (variant === "ticks") return <div className="flow-visual" aria-hidden="true"><span>INTERIOR</span><b>→</b><span>BOUNDARY</span><b>→</b><span>RECOVERY</span></div>;
  if (variant === "shares") return <div className="flow-visual stack" aria-hidden="true"><span>RANGE ID</span><span>LP SHARES</span><span>FEE CHECKPOINTS</span></div>;
  return <div className="flow-visual" aria-hidden="true"><span>FIXTURE</span><b>→</b><span>BIGINT</span><b>→</b><span>REPLAY</span></div>;
}

function Principles() {
  return <section className="section protocol" id="protocol"><p className="section-index">/ 05 · The protocol</p><h2>Shared liquidity, <em>made explicit.</em></h2><div className="principle-grid">
    {principles.map(([number, title, text, visual], index) => <article className={`principle-card ${index === 0 ? "wide" : ""}`} key={number}><CardVisual variant={visual} /><p className="card-number">{number}</p><h3>{title}</h3><p>{text}</p></article>)}
  </div></section>;
}

const architecture = [
  ["01", "Pair interfaces", "Six canonical pair routes are presented to users. They are interfaces over a shared book, not separately funded pools.", ["USDC / USDT", "USDC / DAI", "USDT / FRAX"]],
  ["02", "Orbital hook", "The hook applies the bounded segmented geometry and returns custom swap accounting while advancing a single reserve state.", ["beforeSwap", "SegmentedTorus4", "BeforeSwapDelta"]],
  ["03", "Settlement surface", "The hook holds the basket as PoolManager ERC-6909 claims: it mints the input, burns the output, and the manager settles ERC-20 legs with the router.", ["mint claims", "burn claims", "settle"]],
] as const;

function Architecture() {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const x = useSpring(useTransform(scrollYProgress, [0, 1], ["0%", "-66.5%"]), { stiffness: 120, damping: 28 });
  return <section ref={ref} className={reduced ? "architecture reduced" : "architecture"} aria-labelledby="architecture-title"><div className="architecture-sticky">
    <div className="architecture-title"><p className="section-index">/ 06 · Architecture</p><h2 id="architecture-title">One hook, <em>shared settlement.</em></h2></div>
    <motion.div className="architecture-track" style={reduced ? {} : { x }}>{architecture.map(([number, title, text, labels]) => <article className="architecture-card" key={number}><div><p className="card-number">/ {number} · FEATURE</p><h3>{title}</h3><p>{text}</p></div><div className="architecture-machine">{labels.map((label, index) => <span key={label}>{index > 0 && <i>↓</i>}{label}</span>)}</div></article>)}</motion.div>
  </div></section>;
}

export function toAmount(raw: unknown) {
  const value = BigInt(raw as string); const base = 10n ** 18n;
  return `${value / base}.${((value % base) / (10n ** 16n)).toString().padStart(2, "0")}`;
}

function ReplayPanel() {
  const trace = (fixture as any).trace;
  const result = useMemo(() => replay(trace), [trace]);
  const [frame, setFrame] = useState(0);
  const current = frame === 0 ? { reserves: trace.initialReserves, interiorBitmap: trace.initialInteriorBitmap } : result.steps[frame - 1];
  const values = current.reserves.map((value: unknown) => BigInt(value as string));
  const max = values.reduce((largest: bigint, value: bigint) => value > largest ? value : largest, 0n);
  const next = () => setFrame((value) => Math.min(value + 1, result.steps.length));
  return <div className="replay-panel"><div className="replay-copy"><p className="card-number">SEGMENTED WAD TRACE V1</p><h3>{frame === 0 ? "Initial reserve state" : `Transition ${frame} replayed`}</h3><p>This is the committed offline four-asset crossing fixture, not a live pool read.</p><div className="controls"><button className="button button-solid" onClick={next} disabled={frame === result.steps.length}>Replay transition</button><button className="button" onClick={() => setFrame(0)} disabled={frame === 0}>Reset</button></div></div><div className="replay-data"><div className="reserve-bars" aria-label="Reserve state chart">{values.map((value: bigint, index: number) => <div key={assets[index]}><i style={{ height: `${Number(value * 100n / max)}%` }} /><span>{assets[index]}</span><b>{toAmount(value)}</b></div>)}</div><p className="bitmap">INTERIOR BITMAP · {String(current.interiorBitmap)}</p></div></div>;
}

function SharedHookMap() {
  return <section className="shared-hook" aria-labelledby="shared-hook-title"><div className="shared-hook-heading"><p className="section-index">/ 07 · Route map</p><h2 id="shared-hook-title">Six interfaces.<br /><em>One shared hook.</em></h2><p>Canonical pairs expose the same four-asset reserve state to the quote engine. This map follows one swap through the hook and the real v4 PoolManager.</p></div><div className="hook-map" aria-label="Orbital shared hook architecture">
    <div className="hook-map-users"><p className="hook-map-label">// WHO INTERACTS</p><div className="hook-user-grid"><article className="hook-user-card"><div><h3>Trader</h3><b>exact-input pair route</b></div><p>→ a canonical pair reaches <code>beforeSwap</code>, which returns the custom Orbital delta.</p></article><article className="hook-user-card"><div><h3>Liquidity provider</h3><b>range-local claim model</b></div><p>→ deposits and withdraws a range's current basket through the hook and collects that range's fees.</p></article></div></div>
    <p className="hook-map-arrow">TRADER QUOTES A PAIR · LP HOLDS A RANGE-LOCAL CLAIM ↓</p>
    <div className="hook-map-pairs"><p>6 CANONICAL PAIR INTERFACES</p>{["USDC / USDT", "USDC / DAI", "USDC / FRAX", "USDT / DAI", "USDT / FRAX", "DAI / FRAX"].map((pair) => <span key={pair}>{pair}</span>)}</div>
    <p className="hook-map-arrow">ALL READ AND ADVANCE ONE RESERVE STATE ↓</p>
    <article className="hook-core"><div><p>ORBITAL V4 HOOK</p><h3>OrbitalV4Hook</h3></div><b>// SHARED FOUR-ASSET STATE</b><div className="hook-core-details"><span><strong>beforeSwap</strong>accepts a canonical exact-input route</span><span><strong>one reserve vector</strong>all six routes advance the same state</span><span><strong>range liquidity</strong>shares, fees and inventory held as manager claims</span></div></article>
    <p className="hook-map-arrow">RETURNS CUSTOM DELTA TO THE POOLMANAGER ↓</p>
    <article className="hook-manager"><div><p>UNISWAP V4 POOLMANAGER</p><h3>Settlement</h3></div><b>// ERC-6909 CUSTODY</b><span>Swapper deltas net against the hook's claim mint and burn inside one unlock. Anything unsettled reverts the whole transaction.</span></article>
    <div className="hook-runtime"><p>// ONE EXACT-INPUT QUOTE</p><div><span>canonical route</span><i>→</i><span>beforeSwap</span><i>→</i><span>SegmentedTorus4</span><i>→</i><span>BeforeSwapDelta</span><i>→</i><span>manager settles</span></div></div>
  </div></section>;
}

/** Human display for WAD amounts: grouped digits, fewer decimals as values grow. */
export const displayWad = (value: bigint) => {
  const units = Number(value / (10n ** 12n)) / 1_000_000;
  return units.toLocaleString("en-US", { maximumFractionDigits: units >= 1_000 ? 2 : 4 });
};

const compactWad = (value: bigint) => {
  const units = Number(value / (10n ** 12n)) / 1_000_000;
  return units >= 1_000_000 ? `${(units / 1_000_000).toFixed(1)}M` : units.toLocaleString("en-US", { maximumFractionDigits: 2 });
};

const plotNumber = (value: bigint) => Number(value / (10n ** 12n)) / 1_000_000;

function CurvePlot({ points, committed, preview, input, output, selectedTick, committedBitmap }: { points: CurvePoint[]; committed: bigint[]; preview: bigint[]; input: number; output: number; selectedTick: number; committedBitmap: bigint }) {
  const plot = useMemo(() => {
    const all = [{ inputReserve: committed[input], outputReserve: committed[output], interiorBitmap: committedBitmap }, ...points];
    const xs = all.map((point) => plotNumber(point.inputReserve));
    const ys = all.map((point) => plotNumber(point.outputReserve));
    let minX = Math.min(...xs); let maxX = Math.max(...xs); let minY = Math.min(...ys); let maxY = Math.max(...ys);
    const xPad = Math.max((maxX - minX) * .08, 1); const yPad = Math.max((maxY - minY) * .08, 1);
    minX -= xPad; maxX += xPad; minY -= yPad; maxY += yPad;
    const sx = (value: bigint) => 58 + ((plotNumber(value) - minX) / (maxX - minX)) * 388;
    const sy = (value: bigint) => 264 - ((plotNumber(value) - minY) / (maxY - minY)) * 206;
    const pathFor = (filter?: (point: typeof all[number]) => boolean) => {
      let drawing = false;
      return all.map((point) => {
        const visible = !filter || filter(point);
        if (!visible) { drawing = false; return ""; }
        const command = drawing ? "L" : "M"; drawing = true;
        return `${command}${sx(point.inputReserve).toFixed(2)} ${sy(point.outputReserve).toFixed(2)}`;
      }).join(" ");
    };
    return { sx, sy, basePath: pathFor(), activePath: pathFor((point) => (point.interiorBitmap & (1n << BigInt(selectedTick))) !== 0n), minX, maxX, minY, maxY };
  }, [committed, committedBitmap, input, output, points, selectedTick]);
  const committedX = plot.sx(committed[input]); const committedY = plot.sy(committed[output]);
  const previewX = plot.sx(preview[input]); const previewY = plot.sy(preview[output]);
  return <svg className="curve-plot" viewBox="0 0 500 320" role="img" aria-label={`${assets[input]} and ${assets[output]} reserve cross-section`}>
    {[58, 109.5, 161, 212.5, 264].map((y) => <line key={y} x1="58" x2="446" y1={y} y2={y} />)}
    {[58, 155, 252, 349, 446].map((x) => <line key={x} x1={x} x2={x} y1="58" y2="264" />)}
    <path className="curve-line" d={plot.basePath} />
    <path className="curve-line curve-line-active" d={plot.activePath} />
    <circle className="curve-dot curve-dot-committed" cx={committedX} cy={committedY} r="5" />
    <line className="curve-guide" x1={previewX} x2={previewX} y1={previewY} y2="264" />
    <line className="curve-guide" x1="58" x2={previewX} y1={previewY} y2={previewY} />
    <circle className="curve-dot curve-dot-preview" cx={previewX} cy={previewY} r="6" />
    <text className="curve-coordinate" x={Math.min(410, previewX + 10)} y={Math.max(70, previewY - 10)}>({compactWad(preview[input])}, {compactWad(preview[output])})</text>
    <text x="58" y="287">{plot.minX.toFixed(1)}</text><text x="446" y="287">{plot.maxX.toFixed(1)}</text>
    <text className="axis-label" x="446" y="309">{assets[input]} RESERVE →</text>
    <text className="axis-label axis-label-y" x="58" y="42">↑ {assets[output]} RESERVE</text>
  </svg>;
}

function TickPlane({ committed, preview, ticks, bitmap, crossings, selectedTick }: { committed: bigint[]; preview: bigint[]; ticks: Tick[]; bitmap: bigint; crossings: number; selectedTick: number }) {
  const center = 210; const maxRadius = 126;
  const committedPoint = projectReserveImbalance(committed); const previewPoint = projectReserveImbalance(preview);
  const toPoint = (point: typeof committedPoint) => ({ x: center + point.x * point.magnitude * maxRadius, y: center + point.y * point.magnitude * maxRadius });
  const before = toPoint(committedPoint); const after = toPoint(previewPoint);
  const axes = [["USDC", 1, 0], ["USDT", 0, 1], ["DAI", -1, 0], ["FRAX", 0, -1]] as const;
  return <svg className="tick-plane" viewBox="0 0 420 420" role="img" aria-label="Four-asset tick-plane projection">
    {ticks.map((tick, index) => {
      const radius = 58 + index * (68 / Math.max(1, ticks.length - 1));
      const interior = (bitmap & (1n << BigInt(index))) !== 0n;
      const ratio = Number(tick.k * 100n / tick.radius) / 100;
      return <g key={`${tick.radius}-${tick.k}`}><circle className={`tick-ring ${interior ? "interior" : "boundary"} ${selectedTick === index ? "selected" : ""}`} cx={center} cy={center} r={radius} /><text className={interior ? "tick-label" : "tick-label boundary"} x={center + 8} y={center - radius - 7}>K/R {ratio.toFixed(2)} · {interior ? "INTERIOR" : "BOUNDARY"}</text></g>;
    })}
    {axes.map(([label, x, y]) => <g key={label}><line x1={center} x2={center + x * maxRadius} y1={center} y2={center + y * maxRadius} /><text className="axis-token" x={center + x * (maxRadius + 28)} y={center + y * (maxRadius + 28) + (y === 0 ? 4 : 0)}>{label}</text></g>)}
    <circle className="tick-center" cx={center} cy={center} r="3" /><text x={center} y={center + 18}>PEG</text>
    <circle className="tick-position-committed" cx={before.x} cy={before.y} r="5" />
    <line className="tick-vector" x1={center} y1={center} x2={after.x} y2={after.y} />
    <circle className="tick-position-preview" cx={after.x} cy={after.y} r="6" />
    <text className="crossing-label" x={center} y="398">PREVIEW CROSSINGS · {crossings}</text>
  </svg>;
}

function LaunchSimulator() {
  const [sandbox, setSandbox] = useState(() => createSandboxState());
  const [input, setInput] = useState(0);
  const [output, setOutput] = useState(2);
  const [amountText, setAmountText] = useState("");
  const [selectedTick, setSelectedTick] = useState(0);
  const [history, setHistory] = useState<Array<{ input: number; output: number; amountIn: bigint; amountOut: bigint; crossings: number }>>([]);
  const parsed = useMemo(() => {
    if (!amountText.trim() || /^0+(?:\.0*)?$/.test(amountText.trim())) return { idle: true };
    try { return { value: parseWad(amountText) }; } catch (error) { return { error: quoteMessage(error) }; }
  }, [amountText]);
  const quoted = useMemo<{ preview?: QuotePreview; error?: string }>(() => {
    if (!parsed.value) return parsed.error ? { error: parsed.error } : {};
    try { return { preview: previewSwap(sandbox, input, output, parsed.value) }; } catch (error) { return { error: quoteMessage(error) }; }
  }, [sandbox, input, output, parsed]);
  const curve = useMemo(() => sampleCurve(sandbox, input, output), [sandbox, input, output]);
  const committedBitmap = bitmapForTicks(sandbox.ticks);
  const bitmap = quoted.preview?.interiorBitmap ?? committedBitmap;
  const visibleReserves = quoted.preview?.reserves ?? sandbox.reserves;
  const visibleTicks = quoted.preview?.ticks ?? sandbox.ticks;
  const maxInput = useMemo(() => maxQuotableInput(sandbox, input, output), [sandbox, input, output]);
  const sliderMax = Math.max(1, Number(maxInput / (10n ** 18n)));
  const sliderValue = parsed.value ? Number(parsed.value / (10n ** 18n)) : 0;
  const rate = rateFor(quoted.preview, parsed.value);
  const totalReserve = visibleReserves.reduce((sum, reserve) => sum + reserve, 0n);
  const chooseInput = (next: number) => { setInput(next); if (next === output) setOutput((next + 1) % simulatorAssets.length); setAmountText(""); };
  const chooseOutput = (next: number) => { setOutput(next); if (next === input) setInput((next + simulatorAssets.length - 1) % simulatorAssets.length); setAmountText(""); };
  const swapSides = () => { setInput(output); setOutput(input); setAmountText(""); };
  const commit = () => {
    if (!quoted.preview) return;
    setSandbox(commitPreview(quoted.preview));
    setHistory((entries) => [{ input, output, amountIn: quoted.preview!.amountIn, amountOut: quoted.preview!.amountOut, crossings: quoted.preview!.crossings }, ...entries].slice(0, 4));
    setAmountText("");
  };
  const reset = () => { setSandbox(createSandboxState()); setInput(0); setOutput(2); setAmountText(""); setSelectedTick(0); setHistory([]); };
  const chooseAsset = (kind: "input" | "output", next: number) => kind === "input" ? chooseInput(next) : chooseOutput(next);
  return <section className="simulator-section launch-simulator" id="simulator" aria-labelledby="simulator-title"><div className="simulator-heading"><p className="section-index">/ APP · EXACT-INPUT SANDBOX</p><h2 id="simulator-title">See the reserve book <em>in motion.</em></h2><p>Pick a canonical pair, submit exact input, and inspect the same local BigInt quote through tick planes, a two-asset curve, and the updated four-asset reserve state. A commit advances only this local sandbox, never a live pool.</p></div>
    <div className="simulator-grid">
      <article className="sim-panel sim-plane"><div className="sim-rule"><span>01 / TICK PLANES</span><b>RINGS = TICKS · DOT = RESERVE VECTOR</b></div><TickPlane committed={sandbox.reserves} preview={visibleReserves} ticks={sandbox.ticks} bitmap={bitmap} crossings={quoted.preview?.crossings ?? 0} selectedTick={selectedTick} /><p>The outlined marker is committed state; the filled marker is the live quote preview.</p></article>
      <article className="sim-panel sim-curve"><div className="sim-rule"><span>02 / TWO-ASSET PLANE</span><b>{assets[input]} / {assets[output]} · TICK {selectedTick + 1}</b></div><CurvePlot points={curve} committed={sandbox.reserves} preview={visibleReserves} input={input} output={output} selectedTick={selectedTick} committedBitmap={committedBitmap} /><p>The violet segment is where the selected implemented tick remains interior.</p></article>
      <article className="sim-panel sim-console"><div className="sim-rule"><span>03 / LIVE SWAP</span><b>BIGINT PREVIEW</b></div><div className="asset-picker"><span>PAY</span><div>{simulatorAssets.map((asset, index) => <button type="button" className={input === index ? "asset-choice active" : "asset-choice"} aria-pressed={input === index} onClick={() => chooseAsset("input", index)} key={asset}>{asset}</button>)}</div></div>
        <div className="amount-field"><span>EXACT INPUT</span><label><input aria-label="Exact input amount" inputMode="decimal" placeholder="0.00" value={amountText} onChange={(event) => setAmountText(event.target.value)} /><b>{assets[input]}</b></label><button type="button" onClick={() => setAmountText(formatWad(maxInput, 0))} disabled={maxInput === 0n}>MAX</button></div>
        <input className="amount-slider" aria-label="Input amount slider" type="range" min="0" max={sliderMax} step="1" value={Math.min(sliderMax, Math.max(0, sliderValue))} onChange={(event) => setAmountText(event.target.value)} />
        <button className="swap-sides" type="button" onClick={swapSides} aria-label="Swap input and output assets">↕</button>
        <div className="asset-picker"><span>RECEIVE</span><div>{simulatorAssets.map((asset, index) => <button type="button" className={output === index ? "asset-choice active" : "asset-choice"} aria-pressed={output === index} onClick={() => chooseAsset("output", index)} key={asset}>{asset}</button>)}</div></div>
        <div className="quote-output"><span>COMPUTED OUTPUT</span><strong>{quoted.preview ? displayWad(quoted.preview.amountOut) : "0"} <small>{assets[output]}</small></strong><small>{rate === null ? `Enter an amount to quote ${assets[input]} → ${assets[output]}` : `1 ${assets[input]} ≈ ${rate.toFixed(5)} ${assets[output]} · fee ${displayWad(quoted.preview!.fee)} ${assets[input]} (0.05%)`}</small></div>
        {quoted.error ? <p className="quote-error" role="status">{quoted.error}</p> : <p className="quote-note">{quoted.preview ? `${quoted.preview.crossings} boundary crossing${quoted.preview.crossings === 1 ? "" : "s"} · live BigInt preview` : "Enter an amount to preview the shared reserve state."}</p>}
        <div className="sim-actions"><button className="button button-light" type="button" onClick={commit} disabled={!quoted.preview}>Commit swap</button><button className="button" type="button" onClick={reset}>Reset</button></div>
        <div className="reserve-readout"><p>PREVIEW RESERVE STATE</p>{visibleReserves.map((reserve, index) => <span className={reserve !== sandbox.reserves[index] ? "changed" : ""} key={assets[index]}>{assets[index]} <b>{displayWad(reserve)}</b></span>)}<span className="reserve-total">TOTAL <b>{displayWad(totalReserve)}</b></span></div>
        <div className="sim-ticks"><div><span>TICK PLANE</span><span>K / R</span><span>STATE</span></div>{visibleTicks.map((tick, index) => <button type="button" className={selectedTick === index ? "selected" : ""} onClick={() => setSelectedTick(index)} key={`${tick.radius}-${tick.k}`}><span>{selectedTick === index ? "▸ " : ""}TICK {index + 1}</span><span>{(Number(tick.k * 100n / tick.radius) / 100).toFixed(2)}</span><b>{tick.isInterior ? "INTERIOR" : "BOUNDARY"}</b></button>)}</div>
      </article>
    </div>
    <div className="sim-history" aria-live="polite"><p>COMMITTED SANDBOX TRANSITIONS</p>{history.length ? history.map((entry, index) => <span key={`${entry.input}-${entry.output}-${index}`}>{assets[entry.input]} → {assets[entry.output]} · {displayWad(entry.amountIn)} in · {displayWad(entry.amountOut)} out · {entry.crossings} crossings</span>) : <span>No local swaps committed. The initial demo basket remains active.</span>}</div>
    <StressPanel />
    <div className="sim-trace"><div><p className="section-index">VERIFICATION TRACE</p><h3>Replay the committed crossing fixture.</h3><p>The deterministic trace below remains separate from the interactive sandbox and verifies the versioned WAD transition exactly.</p></div><ReplayPanel /></div>
  </section>;
}

const STRESS_STEPS = [100_000n, 250_000n, 500_000n];

function StressPanel() {
  const [pressured, setPressured] = useState(1);
  const [stepUnits, setStepUnits] = useState(250_000n);
  const against = pressured === 0 ? 1 : 0;
  const run = useMemo(() => depegStress(pressured, against, stepUnits * (10n ** 18n), 40), [pressured, against, stepUnits]);
  const ranges = createSandboxState().ticks.map((tick) => Number(tick.k * 1000n / tick.radius) / 1000);
  return <div className="stress-panel" aria-labelledby="stress-title">
    <div className="stress-heading"><p className="section-index">DEPEG STRESS · MODEL</p><h3 id="stress-title">Depeg stress: who absorbs a failing coin?</h3><p>Sell {simulatorAssets[pressured]} into the demo book for {simulatorAssets[against]} in equal steps. Each range trades until the pressured coin reaches its boundary. Once trapped, a range stops taking in {simulatorAssets[pressured]}, which caps its exposure; wider ranges keep absorbing. This is a model on the deployed parameters, not a guarantee that LPs are protected.</p></div>
    <div className="stress-controls">
      <div className="asset-picker"><span>PRESSURED COIN</span><div>{simulatorAssets.map((asset, index) => <button type="button" key={asset} className={pressured === index ? "asset-choice active" : "asset-choice"} aria-pressed={pressured === index} onClick={() => setPressured(index)}>{asset}</button>)}</div></div>
      <div className="asset-picker"><span>STEP SIZE</span><div>{STRESS_STEPS.map((units) => <button type="button" key={String(units)} className={stepUnits === units ? "asset-choice active" : "asset-choice"} aria-pressed={stepUnits === units} onClick={() => setStepUnits(units)}>{compactWad(units * (10n ** 18n))}</button>)}</div></div>
    </div>
    <div className="stress-legend">{ranges.map((ratio, index) => {
      const price = singleDepegTrapPrice(ratio);
      return <span key={index}><b>RANGE {index + 1}</b> k/r {ratio.toFixed(3)} · {price === null ? "never traps on a single-coin depeg" : `traps near $${price.toFixed(2)} if one coin depegs`}</span>;
    })}</div>
    <div className="stress-table" role="table" aria-label="Depeg stress steps">
      <div role="row" className="stress-head"><span>SOLD</span><span>STEP RATE</span>{ranges.map((_, index) => <span key={index}>RANGE {index + 1} · {simulatorAssets[pressured]} SHARE</span>)}</div>
      <div role="row"><span>0</span><span>—</span>{run.initialExposure.map((share, index) => <span key={index} className="stress-cell"><i style={{ width: `${Math.round(share * 100)}%` }} />{(share * 100).toFixed(1)}%</span>)}</div>
      {run.steps.map((step) => <div role="row" key={String(step.soldTotal)}>
        <span>{compactWad(step.soldTotal)}</span>
        <span>{step.rate.toFixed(4)}</span>
        {step.exposure.map((share, index) => <span key={index} className={step.interior[index] ? "stress-cell" : "stress-cell trapped"}><i style={{ width: `${Math.round(share * 100)}%` }} />{(share * 100).toFixed(1)}%{step.interior[index] ? "" : " · trapped"}</span>)}
      </div>)}
    </div>
    <p className="stress-stop">{run.stoppedBy ?? `Stopped after ${run.steps.length} steps.`}</p>
  </div>;
}

function SandboxTeaser({ navigate }: { navigate: Navigate }) {
  return <section className="sandbox-teaser" id="explorer"><div><p className="section-index">/ 08 · Launch sandbox</p><h2>Trade the shared<br /><em>reserve book.</em></h2><p>Choose any canonical pair and watch a local exact-input quote advance one four-asset state.</p><a className="button button-light" href="/app" onClick={(event) => { event.preventDefault(); navigate("app"); }}>Open sandbox ↗</a></div><div className="teaser-book" aria-label="Initial sandbox reserve state">{simulatorAssets.map((asset, index) => <span key={asset}><i />{asset}<b>{compactWad(createSandboxState().reserves[index])}</b></span>)}<small>4 ASSETS · 6 CANONICAL PAIRS · BIGINT MODEL</small></div></section>;
}

type AppTab = "testnet" | "sandbox";

function LaunchApp({ navigate }: { navigate: Navigate }) {
  const [tab, setTab] = useState<AppTab>("testnet");
  const tabButton = (id: AppTab, label: string) => <button type="button" role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`panel-${id}`} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>;
  return <main className="launch-app"><header className="launch-nav"><button className="launch-brand" type="button" onClick={() => navigate("home")}><OrbitalMark /><span>orbital</span></button><nav><button type="button" onClick={() => navigate("home")}>Protocol</button><button type="button" onClick={() => navigate("docs")}>Docs</button></nav><span className="sandbox-status"><i /> {tab === "testnet" ? "Unichain Sepolia" : "Sandbox active"}</span></header>
    <div className="app-tabs" role="tablist" aria-label="App mode">{tabButton("testnet", "Testnet · live contracts")}{tabButton("sandbox", "Sandbox · local model")}</div>
    <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
      {tab === "testnet"
        ? <section className="testnet-section"><Suspense fallback={<p className="quote-note">Loading the live app…</p>}><LiveApp /></Suspense></section>
        : <LaunchSimulator />}
    </div>
    <LiveDeployment />
    <footer className="launch-footer"><span>Unichain Sepolia testnet · mock tokens · unaudited prototype</span><button type="button" onClick={() => navigate("home")}>Back to landing ↑</button></footer></main>;
}

function FooterCta({ navigate }: { navigate: Navigate }) {
  return <><section className="gateway" id="gateway"><span aria-hidden="true">ORBITAL</span><div><p className="section-index">/ 09 · Gateway</p><h2>The reserve book<br /><em>is taking shape.</em></h2><p>Explore the specification and simulator while the public testnet interface is still being completed.</p><a className="button button-light" href="/docs" onClick={(event) => { event.preventDefault(); navigate("docs"); }}>Read documentation ↗</a></div></section><footer><span>© 2026 Orbital</span><span>Prototype · Not audited · No public deployment</span></footer></>;
}

function Home({ navigate }: { navigate: Navigate }) { return <><Hero navigate={navigate} /><Manifesto /><Problem /><Geometry /><HomePrinciples /><Principles /><Architecture /><SharedHookMap /><SandboxTeaser navigate={navigate} /><FooterCta navigate={navigate} /></>; }

function StoryCaption({ chapter, progress, index }: { chapter: typeof chapters[number]; progress: MotionValue<number>; index: number }) {
  const start = index / 6 + .015; const end = (index + 1) / 6 - .015;
  const fadeIn = Math.max(0, start - .025); const fadeOut = Math.min(1, end + .025);
  const opacity = useTransform(progress, [fadeIn, start, end, fadeOut], [0, 1, 1, 0]);
  const y = useTransform(progress, [fadeIn, start], [18, 0]);
  return <motion.article className="story-caption" style={{ opacity, y }}><p>{chapter[0]}</p><h2>{chapter[1]}</h2><span>{chapter[2]}</span><small>{chapter[3]}</small></motion.article>;
}

function StoryStage({ progress }: { progress: MotionValue<number> }) {
  const first = useTransform(progress, [.0, .18, .26], [1, 1, 0]);
  const book = useTransform(progress, [.14, .28, .44], [0, 1, 1]);
  const geometry = useTransform(progress, [.30, .46, .62], [0, 1, 1]);
  const ranges = useTransform(progress, [.48, .62, .77], [0, 1, 1]);
  const ticks = useTransform(progress, [.68, .84, 1], [0, 1, 1]);
  return <div className="story-stage" aria-hidden="true"><svg viewBox="0 0 1000 560" preserveAspectRatio="xMidYMid meet">
    <g opacity=".2">{[120, 220, 320, 420].map((y) => <line key={y} x1="100" x2="900" y1={y} y2={y} />)}</g>
    <motion.g style={{ opacity: first }}>{[[180,160],[420,160],[660,160],[300,365],[540,365],[780,365]].map(([x,y], index) => <g key={index}><rect x={x} y={y} width="150" height="72" rx="10" /><text x={x + 75} y={y + 42}>{["USDC / USDT", "USDC / DAI", "USDC / FRAX", "USDT / DAI", "USDT / FRAX", "DAI / FRAX"][index]}</text></g>)}</motion.g>
    <motion.g style={{ opacity: book }}><circle cx="500" cy="270" r="126" /><ellipse cx="500" cy="270" rx="150" ry="58" transform="rotate(-28 500 270)" /><ellipse cx="500" cy="270" rx="150" ry="58" transform="rotate(28 500 270)" />{assets.map((asset,index) => <g key={asset}><circle cx={[500,620,500,380][index]} cy={[142,270,398,270][index]} r="14" /><text x={[500,620,500,380][index]} y={[112,240,438,240][index]}>{asset}</text></g>)}<text className="stage-center" x="500" y="276">SHARED BOOK</text></motion.g>
    <motion.g style={{ opacity: geometry }}><path className="stage-curve" d="M255 330 C360 120 640 120 745 330" /><path className="stage-curve faint" d="M255 330 C360 430 640 430 745 330" /><text x="500" y="490">BOUNDED SPHERE4 / TORUS4 SURFACE</text></motion.g>
    <motion.g style={{ opacity: ranges }}><rect x="215" y="438" width="570" height="22" rx="11" /><rect className="stage-accent" x="405" y="438" width="190" height="22" rx="11" /><text x="500" y="418">LP SELECTED RANGE</text></motion.g>
    <motion.g style={{ opacity: ticks }}><path className="stage-trace" d="M170 410 C300 280 400 360 500 230 S710 200 830 110" /><circle className="stage-dot" cx="500" cy="230" r="10" /><text x="550" y="215">TICK CROSSING</text><text x="500" y="92">BEFORESWAP → CUSTOM DELTA</text></motion.g>
  </svg><div className="story-hud"><span>ORBITAL PROTOCOL</span><b>SCROLL STORY</b></div><div className="story-rail"><motion.i style={{ scaleY: progress, transformOrigin: "top" }} /></div></div>;
}

function Docs() {
  const ref = useRef<HTMLElement>(null); const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const progress = useSpring(scrollYProgress, { stiffness: 105, damping: 28, restDelta: .0001 });
  return <main className={reduced ? "docs reduced" : "docs"}><section className="docs-hero"><p className="eyebrow"><b /> PROTOCOL DOCUMENTATION</p><h1>Liquidity is a<br /><em>shared surface.</em></h1><p>Orbital’s prototype explains itself through the reserve state it actually implements. Scroll through the routing, geometry, range, and settlement boundaries.</p><a className="underlink" href="#story">Begin the story ↓</a></section><section ref={ref} className="scroll-story" id="story"><div className="story-sticky"><StoryStage progress={progress} />{chapters.map((chapter, index) => <StoryCaption key={chapter[0]} chapter={chapter} progress={progress} index={index} />)}</div></section><section className="docs-close"><p className="section-index">REFERENCE</p><h2>Read the precise <em>implementation boundary.</em></h2><p>The visual story is an introduction, not a substitute for the specification. The hook settles through the real v4 PoolManager and is deployed with mock tokens on Unichain Sepolia; the specification states every limit.</p><a className="button button-light" href="https://github.com/Sarnav07/Orbital/blob/main/docs/SPECIFICATION.md" target="_blank" rel="noreferrer">Open specification ↗</a></section></main>;
}

export function App() {
  const [ready, setReady] = useState(!firstVisit); const [route, navigate] = useRoute();
  return <><AnimatePresence>{!ready && <Preloader done={() => setReady(true)} />}</AnimatePresence>{route !== "app" && <Nav route={route} navigate={navigate} />}<AnimatePresence mode="wait"><motion.div key={route} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>{route === "docs" ? <Docs /> : route === "app" ? <LaunchApp navigate={navigate} /> : <Home navigate={navigate} />}</motion.div></AnimatePresence></>;
}
