import {
  WAD,
  aggregateTicks,
  attributeRanges,
  quoteExactIn,
  tickGeometry,
} from "../../packages/simulator/src/quote.js";

export const simulatorAssets = ["USDC", "USDT", "DAI", "FRAX"] as const;

export type Tick = { radius: bigint; k: bigint; isInterior: boolean };
export type SandboxState = { reserves: bigint[]; ticks: Tick[] };
export type QuotePreview = {
  amountIn: bigint;
  fee: bigint;
  amountOut: bigint;
  reserves: bigint[];
  ticks: Tick[];
  crossings: number;
  interiorBitmap: bigint;
};
export type CurvePoint = {
  amountIn: bigint;
  amountOut: bigint;
  inputReserve: bigint;
  outputReserve: bigint;
  interiorBitmap: bigint;
};
export type PlanePoint = { x: number; y: number; magnitude: number };

/** Mirrors contracts/script/OrbitalDeployBase.sol (OrbitalDemoConfig). */
export const POOL_FEE_PIPS = 500n;
const FEE_DENOMINATOR = 1_000_000n;
const RANGE_RADIUS = 10_000_000n * WAD;
const EQUAL_PRICE_RESERVE = RANGE_RADIUS * 3n / 2n;
const INITIAL_RESERVES = [EQUAL_PRICE_RESERVE, EQUAL_PRICE_RESERVE, EQUAL_PRICE_RESERVE, EQUAL_PRICE_RESERVE];
const INITIAL_TICKS = [1001n, 1004n, 1050n].map((permille) => ({
  radius: RANGE_RADIUS,
  k: RANGE_RADIUS * permille / 1000n,
  isInterior: true,
}));

export function createSandboxState(): SandboxState {
  return {
    reserves: [...INITIAL_RESERVES],
    ticks: INITIAL_TICKS.map((tick) => ({ ...tick })),
  };
}

export function parseWad(value: string): bigint {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    throw new Error("Enter a positive token amount with up to 18 decimal places.");
  }
  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > 18) throw new Error("Use no more than 18 decimal places.");
  const result = BigInt(whole) * WAD + BigInt(fraction.padEnd(18, "0"));
  if (result <= 0n) throw new Error("Enter an amount greater than zero.");
  return result;
}

export function formatWad(value: bigint, decimals = 4): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / WAD;
  const fraction = (absolute % WAD).toString().padStart(18, "0").slice(0, decimals).replace(/0+$/, "");
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
}

function ticksFromBitmap(ticks: Tick[], bitmap: bigint): Tick[] {
  return ticks.map((tick, index) => ({
    ...tick,
    isInterior: (bitmap & (1n << BigInt(index))) !== 0n,
  }));
}

/** Input-token fee retained by the hook, rounded up exactly as on-chain. */
export function swapFee(amountIn: bigint): bigint {
  return (amountIn * POOL_FEE_PIPS + FEE_DENOMINATOR - 1n) / FEE_DENOMINATOR;
}

export function previewSwap(
  sandbox: SandboxState,
  input: number,
  output: number,
  amountIn: bigint,
): QuotePreview {
  const fee = swapFee(amountIn);
  if (amountIn <= fee) throw new Error("Enter an amount larger than the swap fee.");
  const state = aggregateTicks(sandbox.ticks);
  const result = quoteExactIn({
    state,
    ticks: sandbox.ticks,
    reserves: sandbox.reserves,
    input,
    output,
    amountIn: amountIn - fee,
  });
  return {
    amountIn,
    fee,
    amountOut: result.amountOut,
    reserves: result.reserves,
    ticks: ticksFromBitmap(sandbox.ticks, result.interiorBitmap),
    crossings: result.crossings,
    interiorBitmap: result.interiorBitmap,
  };
}

export function commitPreview(preview: QuotePreview): SandboxState {
  return { reserves: [...preview.reserves], ticks: preview.ticks.map((tick) => ({ ...tick })) };
}

export function interiorBitmap(ticks: Tick[]): bigint {
  return ticks.reduce(
    (value, tick, index) => tick.isInterior ? value | (1n << BigInt(index)) : value,
    0n,
  );
}

/**
 * Projects the four-dimensional reserve imbalance onto a deterministic 2D
 * plane. Opposing assets share an axis so the marker communicates direction
 * and distance from the equal-reserve point without changing quote math.
 */
export function projectReserveImbalance(reserves: bigint[]): PlanePoint {
  if (reserves.length !== 4) throw new Error("Plane projection needs exactly four reserves.");
  const scaled = reserves.map((value) => Number(value / (10n ** 12n)) / 1_000_000);
  const mean = scaled.reduce((sum, value) => sum + value, 0) / scaled.length;
  if (mean === 0) return { x: 0, y: 0, magnitude: 0 };

  const scarce = scaled.map((value) => mean - value);
  const horizontal = scarce[0] - scarce[2];
  const vertical = scarce[1] - scarce[3];
  const rawMagnitude = Math.hypot(horizontal, vertical);
  const magnitude = Math.min(1, rawMagnitude / (mean * 0.9));
  if (rawMagnitude === 0) return { x: 0, y: 0, magnitude: 0 };
  return {
    x: horizontal / rawMagnitude,
    y: vertical / rawMagnitude,
    magnitude,
  };
}

/**
 * Samples the two-asset cross-section on both sides of the committed state:
 * selling `input` moves right along the curve, selling `output` moves left.
 * Points are ordered by input reserve; unquotable points are dropped.
 */
export function sampleCurve(
  sandbox: SandboxState,
  input: number,
  output: number,
  count = 24,
): CurvePoint[] {
  const points: CurvePoint[] = [];
  const side = (sell: number, buy: number) => {
    const maxAmount = sandbox.reserves[sell] * 2n / 5n;
    for (let index = 1; index <= count; index += 1) {
      const amountIn = maxAmount * BigInt(index) / BigInt(count);
      try {
        const quote = previewSwap(sandbox, sell, buy, amountIn);
        points.push({
          amountIn,
          amountOut: quote.amountOut,
          inputReserve: quote.reserves[input],
          outputReserve: quote.reserves[output],
          interiorBitmap: quote.interiorBitmap,
        });
      } catch {
        // A missing root is outside the rendered operating range, not a fabricated point.
      }
    }
  };
  side(input, output);
  side(output, input);
  return points.sort((left, right) => (left.inputReserve < right.inputReserve ? -1 : left.inputReserve > right.inputReserve ? 1 : 0));
}

/**
 * Largest whole-token input the current state can quote, by bisection. Beyond it
 * the engine reaches an unsupported region (all ranges trapped) or the output
 * reserve bound, so the sandbox would only show an error.
 */
export function maxQuotableInput(sandbox: SandboxState, input: number, output: number): bigint {
  const quotes = (units: bigint) => {
    try {
      previewSwap(sandbox, input, output, units * WAD);
      return true;
    } catch {
      return false;
    }
  };
  let low = 0n;
  let high = sandbox.reserves.reduce((sum, reserve) => sum + reserve, 0n) / WAD;
  if (quotes(high)) return high * WAD;
  while (high - low > 1n) {
    const middle = (low + high) / 2n;
    if (quotes(middle)) low = middle;
    else high = middle;
  }
  return low * WAD;
}

/** Output per unit input for a live quote, or null before one exists. */
export function effectiveRate(preview: QuotePreview | undefined, amountIn: bigint | undefined): number | null {
  if (!preview || !amountIn) return null;
  return Number(preview.amountOut * 1_000_000n / amountIn) / 1_000_000;
}

export type StressStep = {
  soldTotal: bigint;
  amountIn: bigint;
  amountOut: bigint;
  /** Average output per input for this step, fee included. */
  rate: number;
  interior: boolean[];
  /** Share of each range's real inventory held in the pressured coin (0–1). */
  exposure: number[];
};

const shareOf = (inventory: bigint[], asset: number) => {
  const total = inventory.reduce((sum, value) => sum + value, 0n);
  return total === 0n ? 0 : Number(inventory[asset] * 1_000_000n / total) / 1_000_000;
};

function exposures(sandbox: SandboxState, asset: number): number[] {
  return attributeRanges({ state: aggregateTicks(sandbox.ticks), ticks: sandbox.ticks, reserves: sandbox.reserves })
    .map((range: { realInventory: bigint[] }) => shareOf(range.realInventory, asset));
}

/**
 * One-sided depeg model: repeatedly sell `stepAmount` of the pressured coin into
 * the demo book for `against`, recording rates, range traps and how much of each
 * range's real inventory ends up in the pressured coin. Stops at the first
 * unsupported state (e.g. every range trapped) and reports why.
 */
export function depegStress(pressured: number, against: number, stepAmount: bigint, maxSteps: number) {
  let sandbox = createSandboxState();
  const initialExposure = exposures(sandbox, pressured);
  const steps: StressStep[] = [];
  let soldTotal = 0n;
  let stoppedBy: string | null = null;
  for (let step = 0; step < maxSteps; step += 1) {
    let preview: QuotePreview;
    try {
      preview = previewSwap(sandbox, pressured, against, stepAmount);
    } catch (error) {
      stoppedBy = /all-boundary/i.test(quoteMessage(error))
        ? "The next step would trap every range at its boundary, which the prototype does not support."
        : quoteMessage(error);
      break;
    }
    sandbox = commitPreview(preview);
    soldTotal += stepAmount;
    steps.push({
      soldTotal,
      amountIn: stepAmount,
      amountOut: preview.amountOut,
      rate: Number(preview.amountOut * 1_000_000n / stepAmount) / 1_000_000,
      interior: sandbox.ticks.map((tick) => tick.isInterior),
      exposure: exposures(sandbox, pressured),
    });
  }
  return { steps, stoppedBy, initialExposure };
}

/**
 * Price p of one coin (others at 1) at which a range with normalized boundary
 * k/r traps, from the specification's single-depeg formula for n = 4:
 * k/r = 2 − (p + 3) / (2·sqrt(p² + 3)). Display-only; null if it never traps.
 */
export function singleDepegTrapPrice(kOverR: number): number | null {
  const lambda = (p: number) => 2 - (p + 3) / (2 * Math.sqrt(p * p + 3));
  if (kOverR <= 1 || kOverR > lambda(0)) return null;
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const middle = (low + high) / 2;
    if (lambda(middle) > kOverR) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

export function quoteMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The quote could not be computed for this state.";
}

export type TickDisplay = { kOverR: number; depeg: number | null; capEff: number };

/**
 * Display terms for a range: the single-coin depeg it tolerates before trapping
 * and its capital efficiency at the peg, q / (q − x_min), as in Sphere4.tick.
 */
export function tickDisplay(tick: Tick): TickDisplay {
  const kOverR = Number(tick.k * 1_000_000n / tick.radius) / 1_000_000;
  const trap = singleDepegTrapPrice(kOverR);
  const q = tick.radius / 2n;
  const { minimumReserve } = tickGeometry(tick.radius, tick.k);
  const capEff = Number(q * 1_000_000n / (q - minimumReserve)) / 1_000_000;
  return { kOverR, depeg: trap === null ? null : 1 - trap, capEff };
}

/**
 * Marginal view of the book, fee excluded: each coin's price is the geometric
 * mean of its one-token rates into the other three, and `depeg` is the worst
 * pairwise discount, the same measure a range's trap depeg is stated in.
 */
export function marginalView(sandbox: SandboxState): { prices: number[]; depeg: number } {
  const state = aggregateTicks(sandbox.ticks);
  const count = sandbox.reserves.length;
  const rate = (input: number, output: number) => {
    try {
      const result = quoteExactIn({ state, ticks: sandbox.ticks, reserves: sandbox.reserves, input, output, amountIn: WAD });
      return Number(result.amountOut * 1_000_000_000n / WAD) / 1_000_000_000;
    } catch {
      return null;
    }
  };
  let depeg = 0;
  const prices = Array.from({ length: count }, (_, asset) => {
    let logSum = 0;
    let quoted = 0;
    for (let other = 0; other < count; other += 1) {
      if (other === asset) continue;
      const value = rate(asset, other);
      if (value === null || value <= 0) continue;
      logSum += Math.log(value);
      quoted += 1;
      depeg = Math.max(depeg, 1 - value);
    }
    return quoted ? Math.exp(logSum / quoted) : 1;
  });
  return { prices, depeg };
}

/** Human display for WAD amounts: grouped digits, fewer decimals as values grow. */
export const displayWad = (value: bigint) => {
  const units = Number(value / (10n ** 12n)) / 1_000_000;
  return units.toLocaleString("en-US", { maximumFractionDigits: units >= 1_000 ? 2 : 4 });
};

/** Millions with one decimal for 1M+ amounts, grouped digits below. */
export const compactWad = (value: bigint) => {
  const units = Number(value / (10n ** 12n)) / 1_000_000;
  return units >= 1_000_000 ? `${(units / 1_000_000).toFixed(1)}M` : units.toLocaleString("en-US", { maximumFractionDigits: 2 });
};

/** Two-decimal WAD display used by the replay fixture, without floating point. */
export function toAmount(raw: unknown) {
  const value = BigInt(raw as string); const base = 10n ** 18n;
  return `${value / base}.${((value % base) / (10n ** 16n)).toString().padStart(2, "0")}`;
}
