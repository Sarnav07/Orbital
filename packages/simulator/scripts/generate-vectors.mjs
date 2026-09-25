// Regenerates packages/fixtures/quote-vectors-v1.json from the BigInt engine.
// Solidity (contracts/test/QuoteVectors.t.sol) replays the same file and must
// reproduce every amountOut, reserve and bitmap exactly.
import { writeFileSync } from "node:fs";
import { WAD, aggregateTicks, attributeRanges, quoteExactIn } from "../src/quote.js";

const RADIUS = 10_000_000n * WAD;
const ticks = [1001n, 1004n, 1050n].map((lambda) => ({ radius: RADIUS, k: RADIUS * lambda / 1000n, isInterior: true }));
const equal = RADIUS * 3n / 2n;
const initialReserves = [equal, equal, equal, equal];

const plan = [
  [0, 1, 1_000n], [1, 2, 25_000n], [2, 3, 250_000n], [3, 0, 10n],
  [0, 2, 1_500_000n], [2, 0, 1_800_000n], [1, 3, 400_000n], [0, 3, 3_000_000n], [3, 0, 3_500_000n],
];

let reserves = [...initialReserves];
let state = ticks.map((tick) => ({ ...tick }));
const actions = [];
for (const [input, output, units] of plan) {
  const amountIn = units * WAD;
  const result = quoteExactIn({ state: aggregateTicks(state), ticks: state, reserves, input, output, amountIn });
  state = state.map((tick, index) => ({ ...tick, isInterior: (result.interiorBitmap & (1n << BigInt(index))) !== 0n }));
  reserves = result.reserves;
  const attribution = attributeRanges({ state: aggregateTicks(state), ticks: state, reserves }).map((range) => ({
    virtualOffset: range.virtualOffset.toString(),
    coordinates: range.coordinates.map(String),
    realInventory: range.realInventory.map(String),
  }));
  actions.push({
    input, output, amountIn: amountIn.toString(), amountOut: result.amountOut.toString(),
    crossings: result.crossings, interiorBitmap: result.interiorBitmap.toString(), reserves: reserves.map(String), attribution,
  });
}

const fixture = {
  version: 1,
  description: "Demo-scale four-asset sequence (three 10M-WAD ranges, k/r 1.001/1.004/1.05) with crossings, recovery and per-range attribution after each step.",
  ticks: ticks.map((tick) => ({ radius: tick.radius.toString(), k: tick.k.toString() })),
  initialReserves: initialReserves.map(String),
  actions,
};
writeFileSync(new URL("../../fixtures/quote-vectors-v1.json", import.meta.url), `${JSON.stringify(fixture, null, 2)}\n`);
console.log(actions.map((a) => `${a.input}->${a.output} ${a.amountIn} => ${a.amountOut} x${a.crossings} bitmap ${a.interiorBitmap}`).join("\n"));
