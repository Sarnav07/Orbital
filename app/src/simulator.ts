import {
  WAD,
  aggregateTicks,
  quoteExactIn,
} from "../../packages/simulator/src/quote.js";

export const simulatorAssets = ["USDC", "USDT", "DAI", "FRAX"] as const;

export type Tick = { radius: bigint; k: bigint; isInterior: boolean };
export type SandboxState = { reserves: bigint[]; ticks: Tick[] };
export type QuotePreview = {
  amountIn: bigint;
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

const INITIAL_RESERVES = [100n * WAD, 100n * WAD, 100n * WAD, 100n * WAD];
const INITIAL_TICKS = [
  { radius: 100n * WAD, k: 110n * WAD, isInterior: true },
  { radius: 100n * WAD, k: 130n * WAD, isInterior: true },
];

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

export function previewSwap(
  sandbox: SandboxState,
  input: number,
  output: number,
  amountIn: bigint,
): QuotePreview {
  const state = aggregateTicks(sandbox.ticks);
  const result = quoteExactIn({
    state,
    ticks: sandbox.ticks,
    reserves: sandbox.reserves,
    input,
    output,
    amountIn,
  });
  return {
    amountIn,
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

export function sampleCurve(
  sandbox: SandboxState,
  input: number,
  output: number,
  count = 24,
): CurvePoint[] {
  const points: CurvePoint[] = [];
  const maxAmount = 100n * WAD;
  for (let index = 1; index <= count; index += 1) {
    const amountIn = maxAmount * BigInt(index) / BigInt(count);
    try {
      const quote = previewSwap(sandbox, input, output, amountIn);
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
  return points;
}

export function quoteMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The quote could not be computed for this state.";
}
