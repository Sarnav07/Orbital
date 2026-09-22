import { useEffect, useMemo, useRef, useState } from "react";
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
  ["01 / FRAGMENTATION", "4 ASSETS → 6 INTERFACES", "Fragmented", "Pair pools make a basket of assets legible as a set of pair interfaces. A four-asset basket has six canonical routes before liquidity is even considered.", "Pair routes do not automatically share reserve state."],
  ["02 / PAIR STATE", "ONE ROUTE AT A TIME", "Pair-local", "A route can price only the reserves assigned to that route. Orbital's premise is to advance one four-asset reserve vector instead of treating each interface as an independent reserve book.", "Every canonical route reads the same shared state."],
  ["03 / BOUNDARIES", "TICK STATUS IS EXPLICIT", "Visible", "A depeg is a state transition that the quote engine must model. The prototype records tick trap and recovery states rather than presenting an unconditional protection claim.", "Scenario behavior depends on the selected ranges and state."],
] as const;

export const geometryCards = [
  ["01 / SPHERE4", "One shared reserve surface.", "‖r − q‖² = r²", "The prototype keeps the four-asset reserve vector on the nonnegative sphere branch. At the equal-price point, its geometry is shared by every supported route."],
  ["02 / TICK BOUNDARY", "Ranges define a boundary.", "α ≤ k", "A selected range is a bounded cap of the sphere, not a disjoint pair price interval. It carries its own virtual offset and attributed real inventory."],
] as const;

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
  ["06 / 06", "Settle at the hook", "The adapter accepts canonical exact-input routes and returns the v4 custom delta. This remains a prototype: no public settlement interface or verified deployment is presented here.", "BEFORESWAP DELTA"],
] as const;

type Route = "home" | "docs";

function useRoute(): [Route, (route: Route) => void] {
  const getRoute = () => location.pathname.replace(/\/+$/, "") === "/docs" ? "docs" : "home";
  const [route, setRoute] = useState<Route>(getRoute);
  useEffect(() => {
    const onPopState = () => setRoute(getRoute());
    addEventListener("popstate", onPopState);
    return () => removeEventListener("popstate", onPopState);
  }, []);
  const navigate = (next: Route) => {
    const target = next === "docs" ? "/docs" : "/";
    if (location.pathname !== target) history.pushState({}, "", target);
    setRoute(next);
    requestAnimationFrame(() => scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }));
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

function Nav({ route, navigate }: { route: Route; navigate: (route: Route) => void }) {
  const [open, setOpen] = useState(false);
  return <header className="nav-shell">
    <a className="brand" href="/" onClick={(event) => { event.preventDefault(); navigate("home"); }}><OrbitalMark /><span>orbital</span></a>
    <button className="menu-button" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>Menu</button>
    <nav className={open ? "nav-links is-open" : "nav-links"} aria-label="Primary navigation">
      <a href="/#protocol" onClick={() => setOpen(false)}>protocol</a>
      <a href="/#explorer" onClick={() => setOpen(false)}>explorer</a>
      <a href="/docs" aria-current={route === "docs" ? "page" : undefined} onClick={(event) => { event.preventDefault(); navigate("docs"); setOpen(false); }}>docs</a>
      <a href="https://www.paradigm.xyz/writing/orbital" target="_blank" rel="noreferrer">paper ↗</a>
    </nav>
    <a className="nav-cta" href={route === "docs" ? "/#gateway" : "#gateway"}>Launch App</a>
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

function Hero() {
  return <section className="hero" id="top">
    <div className="hero-mesh" aria-hidden="true" />
    <HeroOrbital />
    <div className="hero-content">
      <p className="eyebrow"><b /> EXPERIMENTAL UNISWAP V4 HOOK <span>·</span> SHARED STABLECOIN LIQUIDITY</p>
      <h1>One pool for every stablecoin.</h1>
      <p>Four assets. Six pair interfaces. One shared reserve book shaped by Orbital geometry.</p>
      <div className="hero-actions"><a className="button button-solid" href="#protocol">Explore Protocol</a><a className="underlink" href="/docs">Read the story</a></div>
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
    <div className="problem-grid">{problemCards.map(([index, metric, title, text, note]) => <motion.article className="problem-card" key={index} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }} transition={{ duration: .55 }}><div className="card-rule"><span>{index}</span><b>{metric}</b></div><h3>{title}</h3><div className="equation" aria-hidden="true">{title === "Fragmented" ? "N(N − 1) / 2" : title === "Pair-local" ? "xᵢ ↔ xⱼ" : "INTERIOR → BOUNDARY"}</div><p>{text}</p><small>{note}</small></motion.article>)}</div>
  </section>;
}

function Geometry() {
  return <section className="geometry-section" id="geometry" aria-labelledby="geometry-title"><div className="geometry-heading"><p className="section-index">/ 03 · Geometry</p><h2 id="geometry-title">The reserve book is <em>bounded by construction.</em></h2></div><div className="geometry-grid">{geometryCards.map(([index, title, equation, text]) => <motion.article className="geometry-panel" key={index} initial={{ opacity: 0, y: 22 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }} transition={{ duration: .55 }}><div className="card-rule"><span>{index}</span><b>{index === "01 / SPHERE4" ? "ONE VECTOR · FOUR ASSETS" : "LP-SELECTED RANGE"}</b></div><h3>{title}</h3><div className="equation equation-large">{equation}</div><p>{text}</p><ul>{index === "01 / SPHERE4" ? <><li>Four mock stablecoin assets in the current implementation.</li><li>Canonical exact-input pair routes share one reserve vector.</li><li>Custom Orbital pricing replaces v4’s native curve for accepted routes.</li></> : <><li>Ranges track attributed inventory and LP shares.</li><li>Tick trap and recovery are explicit quote-engine states.</li><li>Boundary behavior is constrained by implemented limits.</li></>}</ul></motion.article>)}</div></section>;
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
  ["03", "Settlement surface", "PoolManager remains the custody and settlement surface. Public settlement and verified deployment are explicitly outside this prototype.", ["unlock", "settle", "custody"]],
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

function Explorer() {
  return <section className="section explorer" id="explorer"><div className="explorer-heading"><div><p className="section-index">/ 07 · Explorer</p><h2>The state, <em>in motion.</em></h2></div><p>Replay the committed four-asset crossing fixture. The underlying replayer uses BigInt arithmetic without floating-point accounting.</p></div><ReplayPanel /></section>;
}

function FooterCta() {
  return <><section className="gateway" id="gateway"><span aria-hidden="true">ORBITAL</span><div><p className="section-index">/ 08 · Gateway</p><h2>The reserve book<br /><em>is taking shape.</em></h2><p>Explore the specification and simulator while the public testnet interface is still being completed.</p><a className="button button-light" href="/docs">Read documentation ↗</a></div></section><footer><span>© 2026 Orbital</span><span>Prototype · Not audited · No public deployment</span></footer></>;
}

function Home() { return <><Hero /><Manifesto /><Problem /><Geometry /><HomePrinciples /><Principles /><Architecture /><Explorer /><FooterCta /></>; }

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
  return <main className={reduced ? "docs reduced" : "docs"}><section className="docs-hero"><p className="eyebrow"><b /> PROTOCOL DOCUMENTATION</p><h1>Liquidity is a<br /><em>shared surface.</em></h1><p>Orbital’s prototype explains itself through the reserve state it actually implements. Scroll through the routing, geometry, range, and settlement boundaries.</p><a className="underlink" href="#story">Begin the story ↓</a></section><section ref={ref} className="scroll-story" id="story"><div className="story-sticky"><StoryStage progress={progress} />{chapters.map((chapter, index) => <StoryCaption key={chapter[0]} chapter={chapter} progress={progress} index={index} />)}</div></section><section className="docs-close"><p className="section-index">REFERENCE</p><h2>Read the precise <em>implementation boundary.</em></h2><p>The visual story is an introduction, not a substitute for the specification. The current repository has no verified public deployment or public settlement interface.</p><a className="button button-light" href="../docs/SPECIFICATION.md">Open specification ↗</a></section></main>;
}

export function App() {
  const [ready, setReady] = useState(false); const [route, navigate] = useRoute();
  return <><AnimatePresence>{!ready && <Preloader done={() => setReady(true)} />}</AnimatePresence><Nav route={route} navigate={navigate} /><AnimatePresence mode="wait"><motion.div key={route} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>{route === "docs" ? <Docs /> : <Home />}</motion.div></AnimatePresence></>;
}
