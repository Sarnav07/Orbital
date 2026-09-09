/** Browser-native BigInt replay of versioned Orbital WAD transition traces. */
export const WAD = 10n ** 18n;

const asBigInt = (value) => BigInt(value);

export function replay(trace) {
  if (trace.version !== 1 || trace.assetCount !== 4) throw new Error("unsupported trace");
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
    const next = [...reserves];
    next[input] += amountIn;
    next[output] -= amountOut;
    bitmap = BigInt(action.interiorBitmap);
    steps.push({ reserves: next.map(String), interiorBitmap: bitmap.toString(), amountOut: amountOut.toString() });
    reserves = next;
  }
  return { reserves: reserves.map(String), interiorBitmap: bitmap.toString(), steps };
}

export function assertParity(trace, expected) {
  const actual = replay(trace);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("trace parity mismatch");
  return actual;
}
