// Generates tests/fixtures/random-v1.json: seeded random swap sequences quoted by the
// BigInt engine in packages/simulator (the same engine that produced the Solidity
// vectors). The Rust port must reproduce every result, or fail with the same error.
import { writeFileSync } from "node:fs";
import { WAD, aggregateTicks, attributeRanges, quoteExactIn } from "../../../../packages/simulator/src/quote.js";

let seed = 0x0bb17a1n;
function next() {
  // xorshift64*
  seed ^= seed >> 12n; seed ^= (seed << 25n) & 0xffffffffffffffffn; seed ^= seed >> 27n;
  return (seed * 0x2545f4914f6cdd1dn) & 0xffffffffffffffffn;
}
const below = (n) => next() % n;

const configs = [
  { name: "demo-three-ranges", radii: [10_000_000n, 10_000_000n, 10_000_000n], kPerMille: [1001n, 1004n, 1050n] },
  { name: "two-small-ranges", radii: [100n, 100n], kPerMille: [1100n, 1300n] },
  { name: "five-mixed-ranges", radii: [2_000_000n, 5_000_000n, 1_000_000n, 8_000_000n, 3_000_000n], kPerMille: [1002n, 1010n, 1030n, 1120n, 1400n] },
];

const sequences = [];
for (const config of configs) {
  const ticks = config.radii.map((r, i) => {
    const radius = r * WAD;
    return { radius, k: radius * config.kPerMille[i] / 1000n, isInterior: true };
  });
  const rTotal = ticks.reduce((sum, t) => sum + t.radius, 0n);
  const equal = rTotal / 2n;
  let reserves = [equal, equal, equal, equal];
  let state = ticks.map((t) => ({ ...t }));
  const actions = [];
  for (let step = 0; step < 80; step += 1) {
    const input = Number(below(4n));
    let output = Number(below(3n));
    if (output >= input) output += 1;
    // Log-uniform size from 1e-6 WAD up to ~60% of the output-side reserve.
    const exponent = below(26n);
    const mantissa = 1n + below(9n);
    const cap = reserves[output] * 6n / 10n;
    let amountIn = mantissa * 10n ** exponent * 10n ** 12n;
    if (amountIn > cap) amountIn = cap - below(cap / 100n + 1n);
    if (amountIn <= 0n) amountIn = 1n;
    const action = { input, output, amountIn: amountIn.toString() };
    try {
      const result = quoteExactIn({ state: aggregateTicks(state), ticks: state, reserves, input, output, amountIn });
      state = state.map((t, i) => ({ ...t, isInterior: (result.interiorBitmap & (1n << BigInt(i))) !== 0n }));
      reserves = result.reserves;
      action.amountOut = result.amountOut.toString();
      action.crossings = result.crossings;
      action.interiorBitmap = result.interiorBitmap.toString();
      action.reserves = reserves.map(String);
      try {
        action.attribution = attributeRanges({ state: aggregateTicks(state), ticks: state, reserves }).map((range) => ({
          virtualOffset: range.virtualOffset.toString(),
          coordinates: range.coordinates.map(String),
          realInventory: range.realInventory.map(String),
        }));
      } catch (error) {
        action.attributionError = error.code ?? String(error.message);
      }
    } catch (error) {
      action.error = error.code ?? String(error.message);
    }
    actions.push(action);
  }
  sequences.push({
    name: config.name,
    ticks: ticks.map((t) => ({ radius: t.radius.toString(), k: t.k.toString() })),
    initialReserves: [equal, equal, equal, equal].map(String),
    actions,
  });
}

writeFileSync(new URL("../tests/fixtures/random-v1.json", import.meta.url), `${JSON.stringify({ version: 1, sequences }, null, 2)}\n`);
for (const s of sequences) {
  const ok = s.actions.filter((a) => !a.error);
  const crossed = ok.filter((a) => a.crossings > 0).length;
  const errors = {};
  for (const a of s.actions) if (a.error) errors[a.error] = (errors[a.error] ?? 0) + 1;
  const attrErrors = s.actions.filter((a) => a.attributionError).length;
  console.log(`${s.name}: ${ok.length} ok (${crossed} crossing), errors ${JSON.stringify(errors)}, attribution errors ${attrErrors}`);
}
