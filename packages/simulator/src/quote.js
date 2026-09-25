/** Browser-native BigInt mirror of the bounded Orbital Solidity quote engine. */
export const WAD = 10n ** 18n;

const MAX_COMPONENT = 10n ** 29n;
const MAX_TICKS = 16;
const MAX_CROSSINGS = 8;
const ROOT_SAMPLES = 48n;
const ROOT_ITERATIONS = 96;
const CROSSING_SAMPLES = 48n;
const CROSSING_ITERATIONS = 96;
const MAX_RELATIVE_DRIFT_WAD = 1_000_000_000n;
const SQRT_THREE_WAD = 1_732_050_807_568_877_293n;

export class QuoteError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "QuoteError";
    this.code = code;
  }
}

const fail = (code, message) => { throw new QuoteError(code, message); };
const asBigInt = (value) => BigInt(value);
const abs = (value) => value < 0n ? -value : value;
const crossesOrTouches = (first, second) => first === 0n || second === 0n || (first < 0n && second > 0n) || (first > 0n && second < 0n);

export function mulDivDown(left, right, denominator) {
  const divisor = asBigInt(denominator);
  if (divisor === 0n) fail("DIVISION_BY_ZERO", "Division by zero.");
  return asBigInt(left) * asBigInt(right) / divisor;
}

export const mulWadDown = (left, right) => mulDivDown(left, right, WAD);
export const divWadDown = (left, right) => mulDivDown(left, WAD, right);

export function sqrt(value) {
  const input = asBigInt(value);
  if (input < 0n) fail("INVALID_SQRT", "Square root needs a nonnegative value.");
  if (input < 2n) return input;
  let estimate = 1n << BigInt((input.toString(2).length + 1) >> 1);
  let next = (estimate + input / estimate) >> 1n;
  while (next < estimate) {
    estimate = next;
    next = (estimate + input / estimate) >> 1n;
  }
  return estimate;
}

export const sqrtWad = (value) => sqrt(asBigInt(value) * WAD);

/** Mirrors Sphere4.tick for the fields the engine and attribution need. */
export function tickGeometry(radiusValue, kValue) {
  const radius = asBigInt(radiusValue);
  const k = asBigInt(kValue);
  if (radius <= 0n || radius > MAX_COMPONENT || radius % 2n !== 0n) fail("INVALID_RADIUS", "Invalid tick radius.");
  const maximumK = radius + radius / 2n;
  if (k < radius || k > maximumK) fail("INVALID_BOUNDARY", "Invalid tick boundary.");
  const q = radius / 2n;
  if (k === radius) return { boundaryRadius: 0n, minimumReserve: q, isDegenerate: true };
  const delta = k - radius;
  const boundaryRadius = sqrtWad(mulWadDown(delta, 2n * radius - delta));
  const denominator = k / 2n + mulWadDown(boundaryRadius, SQRT_THREE_WAD) / 2n;
  const distanceToMaximum = maximumK - k;
  // m-d evaluated as (k_max-k)^2/(m+d), exactly as the Solidity geometry does.
  const minimumReserve = k === maximumK ? 0n : divWadDown(mulWadDown(distanceToMaximum, distanceToMaximum), denominator);
  if (minimumReserve >= q) fail("INVALID_BOUNDARY", "Tick has no real reserve at the peg.");
  return { boundaryRadius, minimumReserve, isDegenerate: false };
}

function normalizedState(state) {
  if (!state) fail("INVALID_STATE", "Quote state is required.");
  const result = {
    rInterior: asBigInt(state.rInterior),
    kBoundary: asBigInt(state.kBoundary),
    sBoundary: asBigInt(state.sBoundary)
  };
  if (Object.values(result).some((value) => value < 0n || value > MAX_COMPONENT)) fail("INVALID_STATE", "Quote state is outside the supported domain.");
  return result;
}

function normalizedTicks(ticks) {
  if (!Array.isArray(ticks) || ticks.length === 0 || ticks.length > MAX_TICKS) fail("INVALID_TICK_SET", "Quote needs between one and sixteen ticks.");
  return ticks.map((tick) => ({ radius: asBigInt(tick.radius), k: asBigInt(tick.k), isInterior: Boolean(tick.isInterior) }));
}

function normalizedReserves(reserves) {
  if (!Array.isArray(reserves) || reserves.length !== 4) fail("INVALID_RESERVE", "Quote needs exactly four reserves.");
  const values = reserves.map(asBigInt);
  if (values.some((value) => value < 0n || value > MAX_COMPONENT)) fail("INVALID_RESERVE", "A reserve is outside the supported domain.");
  return values;
}

export function aggregateTicks(ticksValue) {
  const ticks = normalizedTicks(ticksValue);
  const state = { rInterior: 0n, kBoundary: 0n, sBoundary: 0n };
  for (const tick of ticks) {
    const geometry = tickGeometry(tick.radius, tick.k);
    if (geometry.isDegenerate) fail("INVALID_TICK_SET", "Degenerate ticks cannot quote swaps.");
    if (tick.isInterior) state.rInterior += tick.radius;
    else {
      state.kBoundary += tick.k;
      state.sBoundary += geometry.boundaryRadius;
    }
  }
  return state;
}

export function residual(stateValue, reservesValue) {
  const state = normalizedState(stateValue);
  const reserves = normalizedReserves(reservesValue);
  const sum = reserves.reduce((total, value) => total + value, 0n);
  const sumSquares = reserves.reduce((total, value) => total + mulWadDown(value, value), 0n);
  const alphaTotal = sum / 2n;
  if (alphaTotal < state.kBoundary) fail("INVALID_STATE", "Boundary projection exceeds the aggregate reserve projection.");
  const alphaInterior = alphaTotal - state.kBoundary;
  const projectionSquares = mulDivDown(sum, sum, 4n * WAD);
  const centeredSquares = sumSquares > projectionSquares ? sumSquares - projectionSquares : 0n;
  const wNorm = sqrtWad(centeredSquares);
  const first = abs(alphaInterior - state.rInterior * 2n);
  const second = abs(wNorm - state.sBoundary);
  const lhs = mulWadDown(first, first) + mulWadDown(second, second);
  const rhs = mulWadDown(state.rInterior, state.rInterior);
  return lhs - rhs;
}

export function isInvariant(state, reserves) {
  const value = abs(residual(state, reserves));
  const radiusSquared = mulWadDown(asBigInt(state.rInterior), asBigInt(state.rInterior));
  return radiusSquared === 0n ? value === 0n : divWadDown(value, radiusSquared) <= MAX_RELATIVE_DRIFT_WAD;
}

function applyTrade(reservesValue, input, output, amountInValue, amountOutValue) {
  const reserves = normalizedReserves(reservesValue);
  const amountIn = asBigInt(amountInValue);
  const amountOut = asBigInt(amountOutValue);
  if (!Number.isInteger(input) || !Number.isInteger(output) || input < 0 || output < 0 || input >= 4 || output >= 4) fail("INVALID_ASSET_INDEX", "Asset index must be between zero and three.");
  if (input === output) fail("SAME_ASSET", "Choose two different stablecoins.");
  if (amountOut >= reserves[output]) fail("INSUFFICIENT_OUTPUT_RESERVE", "Quote would exhaust the output reserve.");
  if (amountIn < 0n || reserves[input] > MAX_COMPONENT - amountIn) fail("INVALID_RESERVE", "Input would exceed the supported reserve domain.");
  const next = [...reserves];
  next[input] += amountIn;
  next[output] -= amountOut;
  return next;
}

function quoteFixedPartition(state, reserves, input, output, amountInValue) {
  const amountIn = asBigInt(amountInValue);
  if (state.rInterior === 0n) fail("ALL_BOUNDARY_UNSUPPORTED", "The all-boundary continuation is unsupported.");
  if (amountIn <= 0n) fail("ZERO_AMOUNT_IN", "Enter an amount greater than zero.");
  if (!isInvariant(state, reserves)) fail("INVALID_STATE", "Reserves do not satisfy the quoted state.");
  const maximumOutput = reserves[output] - 1n;
  let previousOutput = 0n;
  let previousResidual = residual(state, applyTrade(reserves, input, output, amountIn, 0n));
  for (let sample = 1n; sample <= ROOT_SAMPLES; sample += 1n) {
    const candidateOutput = mulDivDown(maximumOutput, sample, ROOT_SAMPLES);
    const candidateResidual = residual(state, applyTrade(reserves, input, output, amountIn, candidateOutput));
    if (crossesOrTouches(previousResidual, candidateResidual)) {
      let low = previousOutput;
      let high = candidateOutput;
      let lowResidual = previousResidual;
      let highResidual = candidateResidual;
      for (let iteration = 0; iteration < ROOT_ITERATIONS && low < high; iteration += 1) {
        const middle = low + (high - low) / 2n;
        const middleResidual = residual(state, applyTrade(reserves, input, output, amountIn, middle));
        if (middleResidual === 0n) {
          low = middle;
          high = middle;
          lowResidual = 0n;
          highResidual = 0n;
          break;
        }
        if (crossesOrTouches(lowResidual, middleResidual)) {
          high = middle;
          highResidual = middleResidual;
        } else {
          low = middle;
          lowResidual = middleResidual;
        }
      }
      const amountOut = abs(lowResidual) <= abs(highResidual) ? low : high;
      if (!isInvariant(state, applyTrade(reserves, input, output, amountIn, amountOut))) fail("INVARIANT_DRIFT", "Quote exceeds the bounded solver drift.");
      return amountOut;
    }
    previousOutput = candidateOutput;
    previousResidual = candidateResidual;
  }
  fail("NO_PHYSICAL_ROOT", "No physical output root exists for this trade.");
}

function alphaNormalized(state, reserves) {
  if (state.rInterior === 0n) fail("ALL_BOUNDARY_UNSUPPORTED", "The all-boundary continuation is unsupported.");
  const alphaTotal = reserves.reduce((sum, value) => sum + value, 0n) / 2n;
  if (alphaTotal < state.kBoundary) fail("AGGREGATE_MISMATCH", "Reserve projection is below the boundary projection.");
  return divWadDown(alphaTotal - state.kBoundary, state.rInterior);
}

function nextCrossing(ticks, oldAlpha, newAlpha) {
  let found = false;
  let lambda = newAlpha > oldAlpha ? null : 0n;
  if (newAlpha > oldAlpha) {
    for (const tick of ticks) {
      if (!tick.isInterior) continue;
      const candidate = divWadDown(tick.k, tick.radius);
      if (candidate > oldAlpha && candidate <= newAlpha && (lambda === null || candidate < lambda)) {
        lambda = candidate;
        found = true;
      }
    }
  } else if (newAlpha < oldAlpha) {
    for (const tick of ticks) {
      if (tick.isInterior) continue;
      const candidate = divWadDown(tick.k, tick.radius);
      if (candidate < oldAlpha && candidate >= newAlpha && candidate > lambda) {
        lambda = candidate;
        found = true;
      }
    }
  }
  return { found, lambda };
}

function quoteToBoundary(state, reserves, input, output, remaining, lambda) {
  const targetAlphaInterior = mulWadDown(state.rInterior, lambda);
  const targetSum = 2n * (targetAlphaInterior + state.kBoundary);
  const currentSum = reserves.reduce((sum, value) => sum + value, 0n);
  const delta = targetSum - currentSum;
  const lower = delta > 0n ? delta : 0n;
  const upperByReserve = reserves[output] - 1n + delta;
  const upper = remaining < upperByReserve ? remaining : upperByReserve;
  if (upper <= lower) fail("CROSSING_NO_ROOT", "No bounded crossing root exists.");

  const boundaryResidual = (amountIn) => {
    const amountOut = amountIn - delta;
    if (amountOut < 0n) fail("CROSSING_OUTPUT_INVALID", "Crossing requires a negative output.");
    return residual(state, applyTrade(reserves, input, output, amountIn, amountOut));
  };

  let previous = lower;
  let previousResidual = boundaryResidual(previous);
  for (let sample = 1n; sample <= CROSSING_SAMPLES; sample += 1n) {
    const candidate = lower + mulDivDown(upper - lower, sample, CROSSING_SAMPLES);
    const candidateResidual = boundaryResidual(candidate);
    if (crossesOrTouches(previousResidual, candidateResidual)) {
      let low = previous;
      let high = candidate;
      let lowResidual = previousResidual;
      let highResidual = candidateResidual;
      for (let iteration = 0; iteration < CROSSING_ITERATIONS && low < high; iteration += 1) {
        const middle = low + (high - low) / 2n;
        const middleResidual = boundaryResidual(middle);
        if (middleResidual === 0n) return { amountIn: middle, amountOut: middle - delta };
        if (crossesOrTouches(lowResidual, middleResidual)) {
          high = middle;
          highResidual = middleResidual;
        } else {
          low = middle;
          lowResidual = middleResidual;
        }
      }
      const amountIn = abs(lowResidual) <= abs(highResidual) ? low : high;
      return { amountIn, amountOut: amountIn - delta };
    }
    previous = candidate;
    previousResidual = candidateResidual;
  }
  fail("CROSSING_NO_ROOT", "No bounded crossing root exists.");
}

function flipAtBoundary(ticks, lambda, rising) {
  let flips = 0;
  for (const tick of ticks) {
    if (divWadDown(tick.k, tick.radius) !== lambda) continue;
    if ((rising && !tick.isInterior) || (!rising && tick.isInterior)) fail("AGGREGATE_MISMATCH", "Tick status conflicts with crossing direction.");
    tick.isInterior = !rising;
    flips += 1;
  }
  if (flips === 0) fail("INVALID_TICK_SET", "Crossing did not match a tick.");
  return flips;
}

function interiorBitmap(ticks) {
  return ticks.reduce((bitmap, tick, index) => tick.isInterior ? bitmap | (1n << BigInt(index)) : bitmap, 0n);
}

export function quoteExactIn({ state: stateValue, ticks: ticksValue, reserves: reservesValue, input, output, amountIn: amountInValue }) {
  let state = normalizedState(stateValue);
  const ticks = normalizedTicks(ticksValue);
  let reserves = normalizedReserves(reservesValue);
  const amountIn = asBigInt(amountInValue);
  if (input === output) fail("SAME_ASSET", "Choose two different stablecoins.");
  if (amountIn <= 0n) fail("ZERO_AMOUNT_IN", "Enter an amount greater than zero.");
  const rebuilt = aggregateTicks(ticks);
  if (rebuilt.rInterior !== state.rInterior || rebuilt.kBoundary !== state.kBoundary || rebuilt.sBoundary !== state.sBoundary) fail("AGGREGATE_MISMATCH", "Tick set does not match the aggregate state.");
  if (!isInvariant(state, reserves)) fail("AGGREGATE_MISMATCH", "Reserves do not satisfy the aggregate state.");

  let remaining = amountIn;
  let totalOut = 0n;
  let crossings = 0;
  for (let iteration = 0; iteration < MAX_CROSSINGS && remaining > 0n; iteration += 1) {
    if (state.rInterior === 0n) fail("ALL_BOUNDARY_UNSUPPORTED", "The all-boundary continuation is unsupported.");
    const alphaBefore = alphaNormalized(state, reserves);
    const candidateOut = quoteFixedPartition(state, reserves, input, output, remaining);
    const candidate = applyTrade(reserves, input, output, remaining, candidateOut);
    const alphaAfter = alphaNormalized(state, candidate);
    const crossing = nextCrossing(ticks, alphaBefore, alphaAfter);
    if (!crossing.found) {
      reserves = candidate;
      totalOut += candidateOut;
      remaining = 0n;
      break;
    }
    const partial = alphaAfter === crossing.lambda
      ? { amountIn: remaining, amountOut: candidateOut }
      : quoteToBoundary(state, reserves, input, output, remaining, crossing.lambda);
    if (partial.amountIn <= 0n || partial.amountIn > remaining) fail("CROSSING_NO_PROGRESS", "Crossing solver made no progress.");
    reserves = applyTrade(reserves, input, output, partial.amountIn, partial.amountOut);
    totalOut += partial.amountOut;
    remaining -= partial.amountIn;
    crossings += flipAtBoundary(ticks, crossing.lambda, alphaAfter > alphaBefore);
    state = aggregateTicks(ticks);
    if (!isInvariant(state, reserves)) fail("AGGREGATE_MISMATCH", "Crossed reserves do not satisfy the next aggregate state.");
    if (iteration === MAX_CROSSINGS - 1 && remaining > 0n) fail("TOO_MANY_CROSSINGS", "Trade crosses more than eight tick boundaries.");
  }
  if (remaining > 0n) fail("TOO_MANY_CROSSINGS", "Trade crosses more than eight tick boundaries.");
  return { amountOut: totalOut, reserves, state, crossings, interiorBitmap: interiorBitmap(ticks) };
}

/**
 * BigInt port of RangeLiquidity4.attribute: each range's coordinate, its
 * non-redeemable virtual offset, and the real inventory an LP of that range owns.
 */
export function attributeRanges({ state: stateValue, ticks: ticksValue, reserves: reservesValue }) {
  const state = normalizedState(stateValue);
  const ticks = normalizedTicks(ticksValue);
  const reserves = normalizedReserves(reservesValue);
  const rebuilt = aggregateTicks(ticks);
  if (!isInvariant(state, reserves) || rebuilt.rInterior !== state.rInterior || rebuilt.kBoundary !== state.kBoundary || rebuilt.sBoundary !== state.sBoundary) {
    fail("AGGREGATE_MISMATCH", "Tick set does not match the aggregate state.");
  }
  const sum = reserves.reduce((total, value) => total + value, 0n);
  const mean = sum / 4n;
  const alphaInterior = sum / 2n - state.kBoundary;
  const deviation = (value) => value >= mean ? value - mean : mean - value;
  const wNorm = sqrtWad(reserves.reduce((total, value) => total + mulWadDown(deviation(value), deviation(value)), 0n));
  if (wNorm < state.sBoundary) fail("ATTRIBUTION_UNAVAILABLE", "Boundary spread exceeds the reserve spread.");
  const interiorWNorm = wNorm - state.sBoundary;
  return ticks.map((tick) => {
    const geometry = tickGeometry(tick.radius, tick.k);
    const alphaPart = tick.isInterior ? mulDivDown(alphaInterior, tick.radius, state.rInterior) : tick.k;
    const directionNumerator = tick.isInterior ? mulDivDown(interiorWNorm, tick.radius, state.rInterior) : geometry.boundaryRadius;
    const coordinates = reserves.map((value) => {
      let coordinate = alphaPart / 2n;
      if (wNorm !== 0n && directionNumerator !== 0n) {
        const directional = mulDivDown(deviation(value), directionNumerator, wNorm);
        coordinate = value >= mean ? coordinate + directional : coordinate - directional;
      }
      if (coordinate < geometry.minimumReserve) fail("NEGATIVE_REAL_INVENTORY", "A range coordinate fell below its virtual offset.");
      return coordinate;
    });
    return {
      isInterior: tick.isInterior,
      virtualOffset: geometry.minimumReserve,
      coordinates,
      realInventory: coordinates.map((coordinate) => coordinate - geometry.minimumReserve),
    };
  });
}
