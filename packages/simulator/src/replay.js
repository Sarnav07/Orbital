/** Browser-native BigInt replay of versioned Orbital WAD transition traces. */
import { aggregateTicks, quoteExactIn } from "./quote.js";

export const WAD = 10n ** 18n;

const asBigInt = (value) => BigInt(value);

/**
 * Replays a trace and independently recomputes every recorded transition with
 * the bounded quote engine. A recorded amountOut or tick bitmap that the engine
 * does not reproduce exactly is rejected, so the replay verifies the curve
 * rather than trusting the fixture's arithmetic.
 */
export function replay(trace) {
  if (trace.version !== 1 || trace.assetCount !== 4) throw new Error("unsupported trace");
  if (!Array.isArray(trace.ticks) || trace.ticks.length === 0) throw new Error("trace must include its tick set");
  let reserves = trace.initialReserves.map(asBigInt);
  let bitmap = BigInt(trace.initialInteriorBitmap);
  const steps = [];
  for (const action of trace.actions) {
    const input = action.input;
    const output = action.output;
    const amountIn = asBigInt(action.amountIn);
    const amountOut = asBigInt(action.amountOut);
    if (input === output || input < 0 || output < 0 || input >= 4 || output >= 4 || amountIn <= 0n || amountOut >= reserves[output]) {
      throw new Error("invalid action");
    }
    const ticks = trace.ticks.map((tick, index) => ({
      radius: asBigInt(tick.radius),
      k: asBigInt(tick.k),
      isInterior: (bitmap & (1n << BigInt(index))) !== 0n,
    }));
    const quoted = quoteExactIn({ state: aggregateTicks(ticks), ticks, reserves, input, output, amountIn });
    if (quoted.amountOut !== amountOut || quoted.interiorBitmap !== BigInt(action.interiorBitmap)) {
      throw new Error(`transition ${steps.length} does not match the quote engine`);
    }
    reserves = quoted.reserves;
    bitmap = quoted.interiorBitmap;
    steps.push({ reserves: reserves.map(String), interiorBitmap: bitmap.toString(), amountOut: amountOut.toString() });
  }
  return { reserves: reserves.map(String), interiorBitmap: bitmap.toString(), steps };
}

export function assertParity(trace, expected) {
  const actual = replay(trace);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("trace parity mismatch");
  return actual;
}
