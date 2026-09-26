import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react";
import { DEPLOYMENT as deployment, EXPLORER, LIVE_SWAP_TX } from "./chain/deployment";
import { DocsPage } from "./DocsPage";
import { Orbs } from "./ui/Orbs";
import { ThemeMenu } from "./ui/ThemeMenu";
import { compactWad, createSandboxState, simulatorAssets } from "./simulator";

export { displayWad, toAmount } from "./simulator";

const assets = ["USDC", "USDT", "DAI", "FRAX"];
const manifesto = "Stablecoins share a peg, but pair pools split their liquidity. Orbital gives any basket, whether four coins or forty, one reserve surface, then lets each LP choose how tightly to concentrate around the dollar.";

export const principles = [
  ["01 · Reserve book", "Any number of assets, one state.", "Every pair pool trades against the same n-asset reserve book.", "book", "shared-book"],
  ["02 · Geometry", "Sphere meets torus.", "Prices come from n-dimensional sphere and torus geometry, not v4's native curve.", "geometry", "curve"],
  ["03 · LP ranges", "Concentrate by range.", "Each LP picks a range; tighter ranges concentrate liquidity near the peg.", "range", "liquidity"],
  ["04 · Tick transitions", "Model the crossing.", "When a range reaches its boundary, the quote tracks the crossing instead of hiding it.", "ticks", "depegs"],
  ["05 · Attribution", "Positions stay local.", "Range shares claim only their own range's inventory; fees are tracked separately.", "shares", "custody"],
  ["06 · Verification", "Replay every transition.", "A BigInt replayer checks a recorded crossing trace without floating-point math.", "replay", "execution"],
] as const;

export const problemCards = [
  ["01 / FRAGMENTATION", "N COINS → N(N − 1) / 2 POOLS", "Fragmented", "4 → 6 · 8 → 28 · 16 → 120", "n coins need n(n − 1)/2 pair pools, so the same deposits get thinner with every coin added.", "shared-book"],
  ["02 / DENSITY", "STABLESWAP · V3 PAIRS", "Flat", "Σx ⟷ Πx", "Curve spreads depth across prices a dollar never reaches; Uniswap v3 concentrates it, but only for two tokens.", "liquidity"],
  ["03 / TAIL RISK", "USDC → $0.88 · MAR 2023", "Fragile", "pᵢ → 0  ⇒  x̄ → xᵢ", "A flat pool keeps quoting a failing coin near $1, so LPs end up holding it.", "depegs"],
] as const;

export const geometryCards = [
  ["01 / SPHERE", "N-ASSET RESERVE SURFACE", "Reserves live on one n-dimensional sphere.", "Σ(r − xᵢ)² = r²", "All n assets share one surface, one coordinate each. At its centre, every supported pair trades 1:1; the curve bends only as the basket moves away from the peg."],
  ["02 / TICKS", "BOUNDED LP RANGE", "Each LP picks a plane: its range.", "kₘᵢₙ ≤ α ≤ kₘₐₓ", "A tick plane cuts the shared sphere at a selected bound. The range records its virtual offset and attributed inventory while interior and boundary states remain explicit."],
  ["03 / TORUS", "BOUNDED TRANSITIONS", "Interior and boundary ranges form one torus.", "(α − kᵦ − 2rᵢ)² + (‖w‖ − sᵦ)² = rᵢ²", "The bounded Torus4 solver combines the interior and boundary aggregates, then advances through recorded crossings. The prototype accepts up to 16 ranges and 8 status transitions per swap."],
] as const;

const geometryStatement = "The curve is built from three shapes. A sphere holds the reserves. A plane marks each LP's range. A torus folds the active ranges together.";

export const homePrinciples = [
  ["A", "Shared route state", "One pair route updates the same n-asset reserve vector observed by every other route.", "Pair interfaces are not separately funded reserve pools."],
  ["B", "Range-specific claims", "LP shares refer to one normalized range and the attributed inventory of that range—not a global pro-rata claim over every exposure.", "Virtual offsets are mathematical bounds, not redeemable LP inventory."],
  ["C", "Observed transitions", "The segmented engine identifies crossed tick boundaries, records status changes, and can replay the committed transition trace using BigInt arithmetic.", "The trace is an offline model fixture, not a live settlement feed."],
] as const;

const explorerAddress = (address: string) => ({ address, href: `${EXPLORER}/address/${address}` });
// viem and the wallet flow load only when someone opens /app.
const UniApp = lazy(() => import("./uni/UniApp").then((module) => ({ default: module.UniApp })));
const SandboxPage = lazy(() => import("./uni/SandboxPage"));

/** The recorded Unichain Sepolia deployment (contracts/deployments/unichain-sepolia.json). */
export const liveDeployment = {
  chainId: deployment.chainId,
  hook: explorerAddress(deployment.hook),
  router: explorerAddress(deployment.router),
  poolManager: explorerAddress(deployment.poolManager),
  tokens: deployment.currencies.map((address, index) => ({ symbol: deployment.symbols[index], decimals: deployment.decimals[index], ...explorerAddress(address) })),
  swapTx: { hash: LIVE_SWAP_TX, href: `${EXPLORER}/tx/${LIVE_SWAP_TX}` },
};

export const heroTitle = "One reserve book for n stablecoins.";

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
    return path === "/docs" ? "docs" : path === "/app" || path.startsWith("/app/") ? "app" : "home";
  };
  const [route, setRoute] = useState<Route>(getRoute);
  useEffect(() => {
    const onPopState = () => setRoute(getRoute());
    addEventListener("popstate", onPopState);
    return () => removeEventListener("popstate", onPopState);
  }, []);
  const navigate: Navigate = (next, hash) => {
    // For the app, `hash` names a sub-page (for example "sandbox" → /app/sandbox).
    const target = next === "docs" ? "/docs" : next === "app" ? (hash ? `/app/${hash}` : "/app") : "/";
    if (location.pathname !== target) history.pushState({}, "", target);
    setRoute(next);
    if (!hash || next === "app") {
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
  const [menu, setMenu] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(scrollY > 8);
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    return () => removeEventListener("scroll", onScroll);
  }, []);
  return <header className={scrolled ? "site-nav is-scrolled" : "site-nav"}>
    <div className="site-nav-left">
      <a className="site-brand" href="/" onClick={(event) => { event.preventDefault(); navigate("home"); }}><OrbitalMark /><span>Orbital</span></a>
      <button className="site-menu-button" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>Menu</button>
      <nav className={open ? "site-links is-open" : "site-links"} aria-label="Primary navigation">
        <a href="/#protocol" onClick={(event) => { if (route !== "home") { event.preventDefault(); navigate("home", "protocol"); } setOpen(false); }}>Protocol</a>
        <a href="/app/sandbox" onClick={(event) => { event.preventDefault(); navigate("app", "sandbox"); setOpen(false); }}>Simulator</a>
        <a href="/docs" className={route === "docs" ? "active" : ""} aria-current={route === "docs" ? "page" : undefined} onClick={(event) => { event.preventDefault(); navigate("docs"); setOpen(false); }}>Docs</a>
        <a href="https://www.paradigm.xyz/writing/orbital" target="_blank" rel="noreferrer">Paper ↗</a>
      </nav>
    </div>
    <div className="site-nav-right">
      <div className="site-more">
        <button type="button" className="site-icon-button" aria-label="More" aria-expanded={menu} onClick={() => setMenu(!menu)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
        </button>
        {menu && <div className="site-menu" role="menu"><ThemeMenu /><a role="menuitem" href="https://github.com/Sarnav07/Orbital" target="_blank" rel="noreferrer">GitHub ↗</a></div>}
      </div>
      <a className="site-cta" href="/app" onClick={(event) => { event.preventDefault(); navigate("app"); }}>Launch app</a>
    </div>
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
    <Orbs />
    <HeroOrbital />
    <div className="hero-content">
      <p className="eyebrow"><b /> EXPERIMENTAL UNISWAP V4 HOOK <span>·</span> SHARED STABLECOIN LIQUIDITY</p>
      <h1>{heroTitle}</h1>
      <p>n assets. n(n − 1)/2 pair pools. One shared reserve book shaped by Orbital geometry.</p>
      <p className="hero-live">Live now: a 4-coin book (USDC · USDT · DAI · FRAX) on Unichain Sepolia, Ethereum Sepolia, Arbitrum Sepolia and Arc.</p>
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

function Problem({ navigate }: { navigate: Navigate }) {
  return <section className="problem-section" id="problem" aria-labelledby="problem-title">
    <div className="problem-heading"><p className="section-index">/ 02 · The problem</p><h2 id="problem-title">Stablecoins share a peg. <em>Pair pools split the state.</em></h2><p>Orbital starts from one question: can n stablecoins share a single reserve book behind all n(n − 1)/2 of their pair pools? This build answers it for four, live on Unichain Sepolia.</p></div>
    <div className="problem-grid">{problemCards.map(([index, metric, title, equation, line, docsId]) => <motion.article className="problem-card" key={index} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }} transition={{ duration: .55 }}><div className="card-rule"><span>{index}</span><b>{metric}</b></div><h3>{title}</h3><div className="equation" aria-hidden="true">{equation}</div><p className="problem-lead">{line}</p><DocsLink id={docsId} navigate={navigate} /></motion.article>)}</div>
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

/** "Learn more →" to a /docs section, routed client-side. */
function DocsLink({ id, navigate }: { id: string; navigate: Navigate }) {
  return <a className="card-more" href={`/docs#${id}`} onClick={(event) => { event.preventDefault(); navigate("docs", id); }}>Learn more →</a>;
}

function CardVisual({ variant }: { variant: string }) {
  if (variant === "book") return <div className="book-visual" aria-hidden="true">{assets.map((asset) => <span key={asset}>{asset}</span>)}<b>ONE<br />BOOK</b></div>;
  if (variant === "geometry") return <div className="geometry-visual" aria-hidden="true"><i /><i /><i /><b>SPHERE4</b><span>TORUS4</span></div>;
  if (variant === "range") return <div className="range-visual" aria-hidden="true"><i /><i /><b>PEG RANGE</b><span>LP BOUND</span></div>;
  if (variant === "ticks") return <div className="flow-visual" aria-hidden="true"><span>INTERIOR</span><b>→</b><span>BOUNDARY</span><b>→</b><span>RECOVERY</span></div>;
  if (variant === "shares") return <div className="flow-visual stack" aria-hidden="true"><span>RANGE ID</span><span>LP SHARES</span><span>FEE CHECKPOINTS</span></div>;
  return <div className="flow-visual" aria-hidden="true"><span>FIXTURE</span><b>→</b><span>BIGINT</span><b>→</b><span>REPLAY</span></div>;
}

function Principles({ navigate }: { navigate: Navigate }) {
  return <section className="section protocol" id="protocol"><p className="section-index">/ 05 · The protocol</p><h2>Shared liquidity, <em>made explicit.</em></h2><div className="principle-grid">
    {principles.map(([number, title, line, visual, docsId]) => <article className="principle-card" key={number}><CardVisual variant={visual} /><p className="card-number">{number}</p><h3>{title}</h3><p>{line}</p><DocsLink id={docsId} navigate={navigate} /></article>)}
  </div></section>;
}

export const architecture = [
  ["01", "Pair interfaces", "Each pair is a v4 pool: six for four coins, all reading one shared book.", ["USDC / USDT", "USDC / DAI", "USDT / FRAX"], "shared-book"],
  ["02", "Orbital hook", "beforeSwap runs the Orbital geometry and returns a custom delta against one reserve state.", ["beforeSwap", "SegmentedTorus4", "BeforeSwapDelta"], "execution"],
  ["03", "Settlement surface", "The hook holds the basket as PoolManager claims; the manager settles the ERC-20 legs.", ["mint claims", "burn claims", "settle"], "swaps"],
] as const;

function Architecture({ navigate }: { navigate: Navigate }) {
  const ref = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  // How far the track must travel so the last card stops fully in view; measured, not guessed.
  const [distance, setDistance] = useState(0);
  useEffect(() => {
    const measure = () => {
      const node = track.current;
      if (!node) return;
      // scrollWidth already includes both side paddings, so the last card ends one gutter from the right edge.
      setDistance(Math.max(0, node.scrollWidth - window.innerWidth));
    };
    measure();
    addEventListener("resize", measure);
    return () => removeEventListener("resize", measure);
  }, []);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const x = useSpring(useTransform(scrollYProgress, [0, 1], [0, -distance]), { stiffness: 120, damping: 28 });
  return <section ref={ref} className={reduced ? "architecture reduced" : "architecture"} style={{ "--arch-distance": `${distance}px` } as React.CSSProperties} aria-labelledby="architecture-title"><div className="architecture-sticky">
    <div className="architecture-title"><p className="section-index">/ 06 · Architecture</p><h2 id="architecture-title">One hook, <em>shared settlement.</em></h2></div>
    <motion.div ref={track} className="architecture-track" style={reduced ? {} : { x }}>{architecture.map(([number, title, line, labels, docsId]) => <article className="architecture-card" key={number}><div><p className="card-number">/ {number} · Feature</p><h3>{title}</h3><p>{line}</p><DocsLink id={docsId} navigate={navigate} /></div><div className="architecture-machine">{labels.map((label, index) => <span key={label}>{index > 0 && <i>↓</i>}{label}</span>)}</div></article>)}</motion.div>
  </div></section>;
}

function SharedHookMap() {
  return <section className="shared-hook" aria-labelledby="shared-hook-title"><div className="shared-hook-heading"><p className="section-index">/ 07 · Route map</p><h2 id="shared-hook-title">Every pair.<br /><em>One shared hook.</em></h2><p>Every pair pool exposes the same n-asset reserve state to the quote engine. The deployed 4-coin book is shown below. This map follows one swap through the hook and the real v4 PoolManager.</p></div><div className="hook-map" aria-label="Orbital shared hook architecture">
    <div className="hook-map-users"><p className="hook-map-label">// WHO INTERACTS</p><div className="hook-user-grid"><article className="hook-user-card"><div><h3>Trader</h3><b>exact-input pair route</b></div><p>→ a canonical pair reaches <code>beforeSwap</code>, which returns the custom Orbital delta.</p></article><article className="hook-user-card"><div><h3>Liquidity provider</h3><b>range-local claim model</b></div><p>→ deposits and withdraws a range's current basket through the hook and collects that range's fees.</p></article></div></div>
    <p className="hook-map-arrow">TRADER QUOTES A PAIR · LP HOLDS A RANGE-LOCAL CLAIM ↓</p>
    <div className="hook-map-pairs"><p>PAIR POOLS · 4-COIN DEPLOYMENT SHOWN</p>{["USDC / USDT", "USDC / DAI", "USDC / FRAX", "USDT / DAI", "USDT / FRAX", "DAI / FRAX"].map((pair) => <span key={pair}>{pair}</span>)}</div>
    <p className="hook-map-arrow">ALL READ AND ADVANCE ONE RESERVE STATE ↓</p>
    <article className="hook-core"><div><p>ORBITAL V4 HOOK</p><h3>OrbitalV4Hook</h3></div><b>// SHARED N-ASSET STATE</b><div className="hook-core-details"><span><strong>beforeSwap</strong>accepts a canonical exact-input route</span><span><strong>one reserve vector</strong>every pair route advances the same state</span><span><strong>range liquidity</strong>shares, fees and inventory held as manager claims</span></div></article>
    <p className="hook-map-arrow">RETURNS CUSTOM DELTA TO THE POOLMANAGER ↓</p>
    <article className="hook-manager"><div><p>UNISWAP V4 POOLMANAGER</p><h3>Settlement</h3></div><b>// ERC-6909 CUSTODY</b><span>Swapper deltas net against the hook's claim mint and burn inside one unlock. Anything unsettled reverts the whole transaction.</span></article>
    <div className="hook-runtime"><p>// ONE EXACT-INPUT QUOTE</p><div><span>canonical route</span><i>→</i><span>beforeSwap</span><i>→</i><span>SegmentedTorus4</span><i>→</i><span>BeforeSwapDelta</span><i>→</i><span>manager settles</span></div></div>
  </div></section>;
}

function SandboxTeaser({ navigate }: { navigate: Navigate }) {
  return <section className="sandbox-teaser" id="explorer"><div><p className="section-index">/ 08 · Launch sandbox</p><h2>Trade the shared<br /><em>reserve book.</em></h2><p>Choose any pair and watch a local exact-input quote advance one shared n-asset state: here, the deployed 4-coin book.</p><a className="button button-light" href="/app/sandbox" onClick={(event) => { event.preventDefault(); navigate("app", "sandbox"); }}>Open sandbox ↗</a></div><div className="teaser-book" aria-label="Initial sandbox reserve state">{simulatorAssets.map((asset, index) => <span key={asset}><i />{asset}<b>{compactWad(createSandboxState().reserves[index])}</b></span>)}<small>4 ASSETS · 6 CANONICAL PAIRS · BIGINT MODEL</small></div></section>;
}

function LaunchApp({ navigate }: { navigate: Navigate }) {
  return <Suspense fallback={<div className="uni-loading">Loading Orbital…</div>}>
    <UniApp navigate={(route) => navigate(route)} sandbox={<Suspense fallback={<div className="uni-loading">Loading sandbox…</div>}><SandboxPage /></Suspense>} />
  </Suspense>;
}

function FooterCta({ navigate }: { navigate: Navigate }) {
  return <><section className="gateway" id="gateway"><span aria-hidden="true">ORBITAL</span><div><p className="section-index">/ 09 · Gateway</p><h2>The reserve book<br /><em>is taking shape.</em></h2><p>Read the protocol guide, then trade the live 4-coin book on Unichain Sepolia.</p><a className="button button-light" href="/docs" onClick={(event) => { event.preventDefault(); navigate("docs"); }}>Read documentation ↗</a></div></section><footer><span>© 2026 Orbital</span><span>Prototype · Not audited · Live on Unichain Sepolia testnet</span></footer></>;
}

function Home({ navigate }: { navigate: Navigate }) { return <><Hero navigate={navigate} /><Manifesto /><Problem navigate={navigate} /><Geometry /><HomePrinciples /><Principles navigate={navigate} /><Architecture navigate={navigate} /><SharedHookMap /><SandboxTeaser navigate={navigate} /><FooterCta navigate={navigate} /></>; }

export function App() {
  const [ready, setReady] = useState(!firstVisit); const [route, navigate] = useRoute();
  return <><AnimatePresence>{!ready && <Preloader done={() => setReady(true)} />}</AnimatePresence>{route !== "app" && <Nav route={route} navigate={navigate} />}<AnimatePresence mode="wait"><motion.div key={route} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>{route === "docs" ? <DocsPage navigate={navigate} /> : route === "app" ? <LaunchApp navigate={navigate} /> : <Home navigate={navigate} />}</motion.div></AnimatePresence></>;
}
