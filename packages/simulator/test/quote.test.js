import assert from "node:assert/strict";
import test from "node:test";
import { QuoteError, WAD, aggregateTicks, isInvariant, quoteExactIn } from "../src/quote.js";

const initialTicks = () => [
  { radius: 100n * WAD, k: 110n * WAD, isInterior: true },
  { radius: 100n * WAD, k: 130n * WAD, isInterior: true }
];

const initialReserves = () => [100n * WAD, 100n * WAD, 100n * WAD, 100n * WAD];

function quote(amountIn, input = 0, output = 1, ticks = initialTicks(), reserves = initialReserves()) {
  return quoteExactIn({ state: aggregateTicks(ticks), ticks, reserves, input, output, amountIn });
}

const within = (actual, expected, tolerance = 1_000_000_000n) => {
  assert.ok(actual >= expected ? actual - expected <= tolerance : expected - actual <= tolerance);
};

test("quotes a trade within the initial sphere segment", () => {
  const result = quote(60n * WAD);
  within(result.amountOut, 35_646_599_662_505_362_781n);
  assert.equal(result.crossings, 0);
  assert.equal(result.interiorBitmap, 3n);
  assert.equal(isInvariant(result.state, result.reserves), true);
});

test("lands on and records the first boundary", () => {
  const result = quote(80n * WAD);
  within(result.amountOut, 40n * WAD, 2n);
  assert.equal(result.crossings, 1);
  assert.equal(result.interiorBitmap, 2n);
});

test("matches the committed crossing trace exactly", () => {
  const result = quote(100n * WAD);
  assert.equal(result.amountOut, 40_123_552_802_932_248_591n);
  assert.equal(result.crossings, 1);
  assert.equal(result.interiorBitmap, 2n);
});

test("a reverse trade recovers the crossed range", () => {
  const crossed = quote(100n * WAD);
  const crossedTicks = initialTicks();
  crossedTicks[0].isInterior = false;
  const recovered = quoteExactIn({
    state: crossed.state,
    ticks: crossedTicks,
    reserves: crossed.reserves,
    input: 1,
    output: 0,
    amountIn: 10n * WAD
  });
  assert.equal(recovered.crossings, 1);
  assert.equal(recovered.interiorBitmap, 3n);
  assert.equal(isInvariant(recovered.state, recovered.reserves), true);
});

test("balanced reserves quote every pair symmetrically", () => {
  const outputs = [];
  for (let input = 0; input < 4; input += 1) {
    for (let output = 0; output < 4; output += 1) {
      if (input !== output) outputs.push(quote(10n * WAD, input, output).amountOut);
    }
  }
  assert.equal(new Set(outputs.map(String)).size, 1);
});

test("rejects invalid and unsupported quote domains", () => {
  assert.throws(() => quote(0n), (error) => error instanceof QuoteError && error.code === "ZERO_AMOUNT_IN");
  assert.throws(() => quote(WAD, 0, 0), (error) => error instanceof QuoteError && error.code === "SAME_ASSET");
  const allBoundary = initialTicks().map((tick) => ({ ...tick, isInterior: false }));
  assert.throws(
    () => quoteExactIn({ state: aggregateTicks(allBoundary), ticks: allBoundary, reserves: initialReserves(), input: 0, output: 1, amountIn: WAD }),
    (error) => error instanceof QuoteError && ["INVALID_STATE", "AGGREGATE_MISMATCH", "ALL_BOUNDARY_UNSUPPORTED"].includes(error.code)
  );
  assert.throws(
    () => quoteExactIn({ state: aggregateTicks(initialTicks()), ticks: initialTicks(), reserves: [WAD, WAD, WAD, WAD], input: 0, output: 1, amountIn: WAD }),
    (error) => error instanceof QuoteError && error.code === "AGGREGATE_MISMATCH"
  );
  assert.throws(() => quote(10n ** 29n), QuoteError);
});
