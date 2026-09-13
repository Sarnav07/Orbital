import { WAD, replay } from "../../packages/simulator/src/replay.js";
import { ASSET_SYMBOLS } from "./replay-fixture.js";

const SQRT_THREE_WAD = 1_732_050_807_568_877_293n;

export function sqrt(value) {
  const input = BigInt(value);
  if (input < 0n) throw new RangeError("Square root needs a nonnegative value.");
  if (input < 2n) return input;
  let lower = 1n;
  let upper = input;
  while (lower + 1n < upper) {
    const middle = (lower + upper) >> 1n;
    if (middle <= input / middle) lower = middle;
    else upper = middle;
  }
  return lower;
}

function mulWadDown(left, right) {
  return BigInt(left) * BigInt(right) / WAD;
}

function divWadDown(left, right) {
  return BigInt(left) * WAD / BigInt(right);
}

/** Mirrors Sphere4.tick's floored virtual reserve for the fixed four-asset prototype. */
export function tickVirtualOffset(radius, boundary) {
  const r = BigInt(radius);
  const k = BigInt(boundary);
  if (r <= 0n || r % 2n !== 0n || k <= r || k > r + r / 2n) throw new RangeError("Invalid nondegenerate four-asset tick.");
  const delta = k - r;
  const boundaryRadius = sqrt(mulWadDown(delta, 2n * r - delta) * WAD);
  const mean = k / 2n;
  const spread = mulWadDown(boundaryRadius, SQRT_THREE_WAD) / 2n;
  const distanceToMaximum = r + r / 2n - k;
  return divWadDown(mulWadDown(distanceToMaximum, distanceToMaximum), mean + spread);
}

export function formatWad(value, digits = 2) {
  const amount = BigInt(value);
  const whole = amount / WAD;
  const fraction = (amount % WAD).toString().padStart(18, "0").slice(0, digits).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function replayFrames(trace) {
  const result = replay(trace);
  const initial = {
    reserves: trace.initialReserves.map(BigInt),
    interiorBitmap: BigInt(trace.initialInteriorBitmap),
    action: null
  };
  const steps = result.steps.map((step, index) => ({
    reserves: step.reserves.map(BigInt),
    interiorBitmap: BigInt(step.interiorBitmap),
    action: trace.actions[index]
  }));
  return [initial, ...steps];
}

/** Returns an explicitly educational barycentric projection of any three selected reserves. */
export function triangleProjection(reserves, indices = [0, 1, 2]) {
  const selected = indices.map((index) => BigInt(reserves[index]));
  const total = selected.reduce((sum, value) => sum + value, 0n);
  if (total === 0n) throw new RangeError("Projection requires positive reserves.");
  const shares = selected.map((value) => Number(value * 10_000n / total) / 10_000);
  const vertices = [{ x: 50, y: 8 }, { x: 8, y: 88 }, { x: 92, y: 88 }];
  return {
    points: indices.map((index) => ({ ...vertices[indices.indexOf(index)], label: ASSET_SYMBOLS[index] })),
    point: {
      x: shares.reduce((sum, share, index) => sum + share * vertices[index].x, 0),
      y: shares.reduce((sum, share, index) => sum + share * vertices[index].y, 0)
    },
    shares
  };
}

export function pairSlice(reserves, inputIndex, outputIndex) {
  const input = BigInt(reserves[inputIndex]);
  const output = BigInt(reserves[outputIndex]);
  return {
    input: { symbol: ASSET_SYMBOLS[inputIndex], raw: input, display: formatWad(input) },
    output: { symbol: ASSET_SYMBOLS[outputIndex], raw: output, display: formatWad(output) },
    unchanged: ASSET_SYMBOLS.filter((_, index) => index !== inputIndex && index !== outputIndex)
  };
}

export function tickSummary() {
  return [110n, 130n].map((boundary, index) => {
    const radius = 100n * WAD;
    const virtualOffset = tickVirtualOffset(radius, boundary * WAD);
    return {
      rangeId: index,
      virtualOffset,
      virtualDisplay: formatWad(virtualOffset, 4),
      realAtPeg: radius / 2n - virtualOffset,
      realAtPegDisplay: formatWad(radius / 2n - virtualOffset, 4)
    };
  });
}
