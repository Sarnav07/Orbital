import { useMemo, useState } from "react";
import { replay } from "../../../packages/simulator/src/replay.js";
import fixture from "../../../packages/fixtures/segmented-wad-v1.json";
import {
  commitPreview,
  compactWad,
  createSandboxState,
  depegStress,
  displayWad,
  effectiveRate,
  formatWad,
  interiorBitmap,
  marginalView,
  maxQuotableInput,
  parseWad,
  previewSwap,
  projectReserveImbalance,
  quoteMessage,
  sampleCurve,
  simulatorAssets as ASSETS,
  singleDepegTrapPrice,
  tickDisplay,
  toAmount,
  type CurvePoint,
  type QuotePreview,
  type SandboxState,
  type TickDisplay,
} from "../simulator";
import "./sandbox.css";

const logo = (index: number) => `/tokens/${ASSETS[index].toLowerCase()}.png`;
const pct = (value: number) => `${Math.round(value * 100)}%`;
const times = (value: number) => `${value.toFixed(1)}×`;
const millions = (value: number) => `${(value / 1e6).toFixed(1)}M`;
const units = (value: bigint) => Number(value / (10n ** 12n)) / 1_000_000;
const hasBit = (bitmap: bigint, index: number) => (bitmap & (1n << BigInt(index))) !== 0n;

type Transition = { input: number; output: number; amountIn: bigint; amountOut: bigint; crossings: number };

/** The exact-input sandbox: PoolSim's three views (tick planes, two-asset plane, swap) over our 4-asset BigInt model. */
export default function SandboxPage() {
  const [sandbox, setSandbox] = useState<SandboxState>(() => createSandboxState());
  const [input, setInput] = useState(0);
  const [output, setOutput] = useState(2);
  const [amountText, setAmountText] = useState("");
  const [selected, setSelected] = useState(0);
  const [history, setHistory] = useState<Transition[]>([]);

  const parsed = useMemo<{ value?: bigint; error?: string }>(() => {
    if (!amountText.trim() || /^0+(?:\.0*)?$/.test(amountText.trim())) return {};
    try { return { value: parseWad(amountText) }; } catch (error) { return { error: quoteMessage(error) }; }
  }, [amountText]);
  const quoted = useMemo<{ preview?: QuotePreview; error?: string }>(() => {
    if (!parsed.value) return parsed.error ? { error: parsed.error } : {};
    try { return { preview: previewSwap(sandbox, input, output, parsed.value) }; } catch (error) { return { error: quoteMessage(error) }; }
  }, [sandbox, input, output, parsed]);
  const preview: SandboxState = quoted.preview ? { reserves: quoted.preview.reserves, ticks: quoted.preview.ticks } : sandbox;
  const ranges = useMemo(() => sandbox.ticks.map(tickDisplay), [sandbox.ticks]);
  const committedView = useMemo(() => marginalView(sandbox), [sandbox]);
  const previewView = useMemo(() => (quoted.preview ? marginalView(preview) : committedView), [quoted.preview, committedView]); // eslint-disable-line react-hooks/exhaustive-deps
  const curve = useMemo(() => sampleCurve(sandbox, input, output), [sandbox, input, output]);
  const maxInput = useMemo(() => maxQuotableInput(sandbox, input, output), [sandbox, input, output]);
  const rate = effectiveRate(quoted.preview, parsed.value);
  const tightest = Math.min(...ranges.map((range) => range.depeg ?? 1));

  const clear = () => setAmountText("");
  const pickInput = (next: number) => { setInput(next); if (next === output) setOutput(input); clear(); };
  const pickOutput = (next: number) => { setOutput(next); if (next === input) setInput(output); clear(); };
  const flip = () => { setInput(output); setOutput(input); clear(); };
  const commit = () => {
    const done = quoted.preview;
    if (!done) return;
    setSandbox(commitPreview(done));
    setHistory((entries) => [{ input, output, amountIn: done.amountIn, amountOut: done.amountOut, crossings: done.crossings }, ...entries].slice(0, 4));
    clear();
  };
  const reset = () => { setSandbox(createSandboxState()); setInput(0); setOutput(2); clear(); setSelected(0); setHistory([]); };

  const sliderMax = Math.max(1, Number(maxInput / (10n ** 18n)));
  const sliderValue = parsed.value ? Math.min(sliderMax, Number(parsed.value / (10n ** 18n))) : 0;
  const tvl = preview.reserves.reduce((sum, reserve) => sum + reserve, 0n);

  return <section className="sb" aria-labelledby="sb-title">
    <header className="sb-heading">
      <p className="sb-eyebrow">Sandbox · exact input</p>
      <h1 id="sb-title">See the reserve book <em>in motion.</em></h1>
      <p>Pick a pair, enter an exact input and watch one local BigInt quote two ways: looking down the tick planes, and along the curve between the two coins you trade. A commit advances only this local sandbox, never a live pool.</p>
    </header>

    <div className="sb-grid">
      <article className="sb-card sb-plane">
        <CardHead title="A · Tick planes" meta="rings = ranges · dot = reserve vector" />
        <div className="sb-figure"><TickPlane committed={sandbox} preview={preview} ranges={ranges} committedDepeg={committedView.depeg} previewDepeg={previewView.depeg} selected={selected} /></div>
        <p className="sb-legend">Ring size is the single-coin depeg a range tolerates; the label adds its capital efficiency at the peg. Hollow marker: committed state. Filled marker: the live preview.</p>
      </article>

      <article className="sb-card sb-curve">
        <CardHead title="B · Two-asset plane" meta={`${ASSETS[input]} / ${ASSETS[output]} · range ${selected + 1}`} />
        <div className="sb-figure"><CurvePlot points={curve} committed={sandbox.reserves} preview={preview.reserves} input={input} output={output} selected={selected} /></div>
        <p className="sb-legend">Pink is where range {selected + 1} stays interior along this pair's curve. Dashed markers show where it reaches its boundary.</p>
      </article>

      <article className="sb-card sb-swap">
        <CardHead title="C · Swap" meta="local BigInt quote" />
        <div className="sb-box">
          <div className="sb-box-top"><span>Sell</span><Chips active={input} onPick={pickInput} label="Sell token" /></div>
          <div className="sb-amount">
            <input aria-label="Exact input amount" inputMode="decimal" placeholder="0" value={amountText} onChange={(event) => setAmountText(event.target.value)} />
            <button type="button" className="sb-max" onClick={() => setAmountText(formatWad(maxInput, 0))} disabled={maxInput === 0n}>Max</button>
          </div>
          <input className="sb-slider" aria-label="Input amount slider" type="range" min="0" max={sliderMax} step="1" value={sliderValue} onChange={(event) => setAmountText(event.target.value)} />
          <small>Max quotable {compactWad(maxInput)} {ASSETS[input]}</small>
        </div>
        <button type="button" className="sb-flip" onClick={flip} aria-label="Swap input and output assets">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16m0 0-6-6m6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <div className="sb-box">
          <div className="sb-box-top"><span>Buy</span><Chips active={output} onPick={pickOutput} label="Buy token" /></div>
          <div className="sb-amount"><output className={quoted.preview ? "" : "empty"}>{quoted.preview ? displayWad(quoted.preview.amountOut) : "0"}</output></div>
          <small>{rate === null ? `Enter an amount to quote ${ASSETS[input]} → ${ASSETS[output]}` : `1 ${ASSETS[input]} ≈ ${rate.toFixed(5)} ${ASSETS[output]}`}</small>
        </div>
        {quoted.error
          ? <p className="sb-info sb-error" role="status">{quoted.error}</p>
          : <p className="sb-info">{quoted.preview ? `Fee ${displayWad(quoted.preview.fee)} ${ASSETS[input]} (0.05%) · ${quoted.preview.crossings} boundary crossing${quoted.preview.crossings === 1 ? "" : "s"}` : "The preview updates every view before you commit."}</p>}
        <div className="sb-actions">
          <button type="button" className="sb-commit" onClick={commit} disabled={!quoted.preview}>Commit swap</button>
          <button type="button" className="sb-reset" onClick={reset}>Reset</button>
        </div>

      </article>

        <section className="sb-card sb-readout" aria-label="Virtual reserves">
          <CardHead title="Virtual reserves" meta="reserve · marginal price" />
          {preview.reserves.map((reserve, index) => {
            const price = previewView.prices[index];
            return <div className={reserve !== sandbox.reserves[index] ? "sb-reserve changed" : "sb-reserve"} key={ASSETS[index]}>
              <span><img src={logo(index)} alt="" />{ASSETS[index]}</span>
              <b>{compactWad(reserve)}</b>
              <i className={Math.abs(price - 1) >= tightest ? "off" : ""}>{price.toFixed(4)}</i>
            </div>;
          })}
          <div className="sb-reserve sb-tvl"><span>Total</span><b>{compactWad(tvl)}</b><i /></div>
        </section>

        <section className="sb-card sb-ranges" aria-label="Ranges">
          <CardHead title="Ranges" meta="select one to trace it in B" />
          <div className="sb-ranges-head"><span>Range</span><span>Depeg</span><span>Cap. eff.</span><span>State</span></div>
          {ranges.map((range, index) => {
            const interior = preview.ticks[index].isInterior;
            return <button type="button" key={index} className={selected === index ? "sb-range-row selected" : "sb-range-row"} aria-pressed={selected === index} onClick={() => setSelected(index)}>
              <span>Range {index + 1}</span><span>{range.depeg === null ? "—" : pct(range.depeg)}</span><span>{times(range.capEff)}</span>
              <b className={interior ? "interior" : "boundary"}>{interior ? "Interior" : "Boundary"}</b>
            </button>;
          })}
        </section>
    <section className="sb-card sb-history" aria-live="polite">
      <CardHead title="Committed transitions" meta="this sandbox only" />
      {history.length
        ? <ul>{history.map((entry, index) => <li key={index}><span><img src={logo(entry.input)} alt="" />{displayWad(entry.amountIn)} {ASSETS[entry.input]}</span><i>→</i><span><img src={logo(entry.output)} alt="" />{displayWad(entry.amountOut)} {ASSETS[entry.output]}</span><small>{entry.crossings} crossing{entry.crossings === 1 ? "" : "s"}</small></li>)}</ul>
        : <p className="sb-muted">No local swaps committed. The initial demo basket is active.</p>}
    </section>

    </div>

    <StressPanel />
    <ReplayPanel />
  </section>;
}

function CardHead({ title, meta }: { title: string; meta?: string }) {
  return <div className="sb-card-head"><span>{title}</span>{meta && <small>{meta}</small>}</div>;
}

function Chips({ active, onPick, label }: { active: number; onPick: (index: number) => void; label: string }) {
  return <div className="sb-chips" role="group" aria-label={label}>{ASSETS.map((asset, index) =>
    <button type="button" key={asset} className={active === index ? "active" : ""} aria-pressed={active === index} onClick={() => onPick(index)}><img src={logo(index)} alt="" />{asset}</button>)}</div>;
}

// ── A: looking down the equal-price axis ──
const A_SIZE = 360;
const A_CENTER = A_SIZE / 2;
const RIM = 128;
const RING_SOFTNESS = 0.03;
const AXES = [["USDC", 1, 0], ["USDT", 0, 1], ["DAI", -1, 0], ["FRAX", 0, -1]] as const;

function TickPlane({ committed, preview, ranges, committedDepeg, previewDepeg, selected }: { committed: SandboxState; preview: SandboxState; ranges: TickDisplay[]; committedDepeg: number; previewDepeg: number; selected: number }) {
  const widest = Math.max(...ranges.map((range) => range.depeg ?? 0), 0.01);
  // log1p spacing keeps the tight ranges apart while the widest range sits on the rim.
  const radius = (depeg: number) => RIM * Math.log1p(Math.min(depeg, widest * 1.1) / RING_SOFTNESS) / Math.log1p(widest / RING_SOFTNESS);
  const marker = (state: SandboxState, depeg: number) => {
    const direction = projectReserveImbalance(state.reserves);
    const distance = direction.magnitude === 0 ? 0 : radius(depeg);
    return { x: A_CENTER + direction.x * distance, y: A_CENTER + direction.y * distance };
  };
  const before = marker(committed, committedDepeg);
  const after = marker(preview, previewDepeg);
  const breached = preview.ticks.some((tick) => !tick.isInterior);
  return <svg viewBox={`0 0 ${A_SIZE} ${A_SIZE}`} role="img" aria-label="Four-asset tick-plane projection">
    {AXES.map(([label, x, y]) => <g key={label}>
      <line className="sb-axis" x1={A_CENTER} y1={A_CENTER} x2={A_CENTER + x * RIM} y2={A_CENTER + y * RIM} />
      <text className="sb-token" x={A_CENTER + x * (RIM + (y === 0 ? 26 : 30))} y={A_CENTER + y * (RIM + (y === 0 ? 26 : 30))} textAnchor="middle" dominantBaseline="middle">{label}</text>
    </g>)}
    {ranges.map((range, index) => {
      if (range.depeg === null) return null;
      const r = radius(range.depeg);
      const interior = preview.ticks[index].isInterior;
      return <g key={index}>
        <circle className={`sb-ring ${interior ? "interior" : "boundary"}${selected === index ? " selected" : ""}`} cx={A_CENTER} cy={A_CENTER} r={r} />
        <text className={interior ? "sb-ring-label" : "sb-ring-label boundary"} x={A_CENTER + 6} y={A_CENTER - r - 4}>{pct(range.depeg)} · {times(range.capEff)}</text>
      </g>;
    })}
    <circle className="sb-peg" cx={A_CENTER} cy={A_CENTER} r="2.5" />
    <text className="sb-peg-label" x={A_CENTER} y={A_CENTER + 16} textAnchor="middle">Peg</text>
    <circle className="sb-marker-committed" cx={before.x} cy={before.y} r="5" />
    <line className={breached ? "sb-vector breached" : "sb-vector"} x1={A_CENTER} y1={A_CENTER} x2={after.x} y2={after.y} />
    <circle className={breached ? "sb-marker breached" : "sb-marker"} cx={after.x} cy={after.y} r="5.5" />
  </svg>;
}

// ── B: two-asset plane ──
const B_W = 420;
const B_H = 360;
const PL = 52;
const PR = 18;
const PT = 26;
const PB = 44;

function CurvePlot({ points, committed, preview, input, output, selected }: { points: CurvePoint[]; committed: bigint[]; preview: bigint[]; input: number; output: number; selected: number }) {
  const plot = useMemo(() => {
    const xs = [...points.map((point) => units(point.inputReserve)), units(committed[input]), units(preview[input])];
    const ys = [...points.map((point) => units(point.outputReserve)), units(committed[output]), units(preview[output])];
    const low = Math.min(...xs, ...ys);
    const high = Math.max(...xs, ...ys);
    const pad = Math.max((high - low) * 0.04, 1);
    const lo = low - pad;
    const span = high + pad - lo;
    const sx = (value: number) => PL + ((value - lo) / span) * (B_W - PL - PR);
    const sy = (value: number) => B_H - PB - ((value - lo) / span) * (B_H - PT - PB);
    const path = (visible: (point: CurvePoint) => boolean) => {
      let drawing = false;
      return points.map((point) => {
        if (!visible(point)) { drawing = false; return ""; }
        const command = drawing ? "L" : "M";
        drawing = true;
        return `${command}${sx(units(point.inputReserve)).toFixed(1)} ${sy(units(point.outputReserve)).toFixed(1)}`;
      }).join(" ");
    };
    const flips = points.filter((point, index) => index > 0 && hasBit(point.interiorBitmap, selected) !== hasBit(points[index - 1].interiorBitmap, selected));
    return { lo, span, sx, sy, base: path(() => true), active: path((point) => hasBit(point.interiorBitmap, selected)), flips };
  }, [points, committed, preview, input, output, selected]);
  const grid = [0, 1, 2, 3, 4].map((step) => plot.lo + (plot.span * step) / 4);
  const committedPoint = { x: plot.sx(units(committed[input])), y: plot.sy(units(committed[output])) };
  const current = { x: plot.sx(units(preview[input])), y: plot.sy(units(preview[output])) };
  const labelRight = current.x < B_W - 130;
  return <svg viewBox={`0 0 ${B_W} ${B_H}`} role="img" aria-label={`${ASSETS[input]} and ${ASSETS[output]} reserve cross-section`}>
    {grid.map((value, index) => <g key={index}>
      <line className="sb-grid-line" x1={plot.sx(value)} y1={PT} x2={plot.sx(value)} y2={B_H - PB} />
      <line className="sb-grid-line" x1={PL} y1={plot.sy(value)} x2={B_W - PR} y2={plot.sy(value)} />
      <text className="sb-axis-value" x={plot.sx(value)} y={B_H - PB + 15} textAnchor="middle">{millions(value)}</text>
      <text className="sb-axis-value" x={PL - 7} y={plot.sy(value) + 3} textAnchor="end">{millions(value)}</text>
    </g>)}
    <line className="sb-axis" x1={PL} y1={B_H - PB} x2={B_W - PR} y2={B_H - PB} />
    <line className="sb-axis" x1={PL} y1={PT} x2={PL} y2={B_H - PB} />
    <path className="sb-curve-line" d={plot.base} />
    <path className="sb-curve-active" d={plot.active} />
    {plot.flips.map((point, index) => {
      const x = plot.sx(units(point.inputReserve));
      return <line key={index} className="sb-flip-mark" x1={x} y1={plot.sy(units(point.outputReserve))} x2={x} y2={B_H - PB} />;
    })}
    <circle className="sb-marker-committed" cx={committedPoint.x} cy={committedPoint.y} r="5" />
    <line className="sb-guide" x1={current.x} y1={current.y} x2={current.x} y2={B_H - PB} />
    <line className="sb-guide" x1={PL} y1={current.y} x2={current.x} y2={current.y} />
    <circle className="sb-marker" cx={current.x} cy={current.y} r="5.5" />
    <text className="sb-coordinate" x={labelRight ? current.x + 10 : current.x - 10} y={Math.max(PT + 10, current.y - 9)} textAnchor={labelRight ? "start" : "end"}>({compactWad(preview[input])}, {compactWad(preview[output])})</text>
    <text className="sb-axis-title" x={B_W - PR} y={B_H - 6} textAnchor="end">{ASSETS[input]} reserve →</text>
    <text className="sb-axis-title" x={PL} y={PT - 10} textAnchor="start">↑ {ASSETS[output]} reserve</text>
  </svg>;
}

// ── Depeg stress model ──
const STRESS_STEPS = [100_000n, 250_000n, 500_000n];

function StressPanel() {
  const [pressured, setPressured] = useState(1);
  const [stepUnits, setStepUnits] = useState(250_000n);
  const against = pressured === 0 ? 1 : 0;
  const run = useMemo(() => depegStress(pressured, against, stepUnits * (10n ** 18n), 40), [pressured, against, stepUnits]);
  const ranges = useMemo(() => createSandboxState().ticks.map((tick) => Number(tick.k * 1000n / tick.radius) / 1000), []);
  return <section className="sb-card sb-stress" aria-labelledby="sb-stress-title">
    <div className="sb-section-copy">
      <p className="sb-eyebrow">Depeg stress · model</p>
      <h2 id="sb-stress-title">Depeg stress: who absorbs a failing coin?</h2>
      <p>Sell {ASSETS[pressured]} into the demo book for {ASSETS[against]} in equal steps. Each range trades until the pressured coin reaches its boundary. Once trapped, a range stops taking in {ASSETS[pressured]}, which caps its exposure; wider ranges keep absorbing. This is a model on the deployed parameters, not a guarantee that LPs are protected.</p>
    </div>
    <div className="sb-stress-controls">
      <div><span>Pressured coin</span><Chips active={pressured} onPick={setPressured} label="Pressured coin" /></div>
      <div><span>Step size</span><div className="sb-chips" role="group" aria-label="Step size">{STRESS_STEPS.map((step) => <button type="button" key={String(step)} className={stepUnits === step ? "active" : ""} aria-pressed={stepUnits === step} onClick={() => setStepUnits(step)}>{compactWad(step * (10n ** 18n))}</button>)}</div></div>
    </div>
    <ul className="sb-stress-legend">{ranges.map((ratio, index) => {
      const price = singleDepegTrapPrice(ratio);
      return <li key={index}><b>Range {index + 1}</b> k/r {ratio.toFixed(3)} · {price === null ? "never traps on a single-coin depeg" : `traps near $${price.toFixed(2)} if one coin depegs`}</li>;
    })}</ul>
    <div className="sb-table-wrap">
      <div className="sb-stress-table" role="table" aria-label="Depeg stress steps">
        <div role="row" className="sb-stress-head"><span>Sold</span><span>Step rate</span>{ranges.map((_, index) => <span key={index}>Range {index + 1} · {ASSETS[pressured]} share</span>)}</div>
        <div role="row"><span>0</span><span>—</span>{run.initialExposure.map((share, index) => <StressCell key={index} share={share} trapped={false} />)}</div>
        {run.steps.map((step) => <div role="row" key={String(step.soldTotal)}>
          <span>{compactWad(step.soldTotal)}</span>
          <span>{step.rate.toFixed(4)}</span>
          {step.exposure.map((share, index) => <StressCell key={index} share={share} trapped={!step.interior[index]} />)}
        </div>)}
      </div>
    </div>
    <p className="sb-muted">{run.stoppedBy ?? `Stopped after ${run.steps.length} steps.`}</p>
  </section>;
}

function StressCell({ share, trapped }: { share: number; trapped: boolean }) {
  return <span className={trapped ? "sb-cell trapped" : "sb-cell"}><i style={{ width: `${Math.round(share * 100)}%` }} /><em>{(share * 100).toFixed(1)}%{trapped ? " · trapped" : ""}</em></span>;
}

// ── Verification trace ──
function ReplayPanel() {
  const trace = (fixture as { trace: any }).trace; // eslint-disable-line @typescript-eslint/no-explicit-any
  const result = useMemo(() => replay(trace), [trace]);
  const [frame, setFrame] = useState(0);
  const current = frame === 0 ? { reserves: trace.initialReserves, interiorBitmap: trace.initialInteriorBitmap } : result.steps[frame - 1];
  const values: bigint[] = current.reserves.map((value: unknown) => BigInt(value as string));
  const max = values.reduce((largest, value) => (value > largest ? value : largest), 1n);
  const bitmap = BigInt(current.interiorBitmap);
  return <section className="sb-card sb-replay" aria-labelledby="sb-replay-title">
    <div className="sb-section-copy">
      <p className="sb-eyebrow">Verification trace</p>
      <h2 id="sb-replay-title">Replay the committed crossing fixture.</h2>
      <p>The deterministic trace is separate from the interactive sandbox. It replays the versioned four-asset WAD transition exactly with BigInt arithmetic; it is an offline fixture, not a live pool read.</p>
      <p className="sb-replay-state">{frame === 0 ? "Initial reserve state" : `Transition ${frame} of ${result.steps.length} replayed`}</p>
      <div className="sb-replay-actions">
        <button type="button" className="sb-commit" onClick={() => setFrame((value) => Math.min(value + 1, result.steps.length))} disabled={frame === result.steps.length}>Replay transition</button>
        <button type="button" className="sb-reset" onClick={() => setFrame(0)} disabled={frame === 0}>Reset</button>
      </div>
    </div>
    <div className="sb-bars" aria-label="Reserve state chart">
      {values.map((value, index) => <div key={ASSETS[index]}>
        <b>{toAmount(value)}</b>
        <i style={{ height: `${Number(value * 100n / max)}%` }} />
        <span><img src={logo(index)} alt="" />{ASSETS[index]}</span>
      </div>)}
      <p>Interior ranges: {trace.ticks.map((_: unknown, index: number) => index).filter((index: number) => hasBit(bitmap, index)).map((index: number) => index + 1).join(", ") || "none"} · bitmap {String(bitmap)}</p>
    </div>
  </section>;
}
