import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { aggregateTicks, quoteExactIn } from "../src/quote.js";

const fixture = JSON.parse(readFileSync(new URL("../../fixtures/quote-vectors-v1.json", import.meta.url)));

test("the BigInt engine reproduces the shared Solidity/JS vectors exactly", () => {
  let ticks = fixture.ticks.map((tick) => ({ radius: BigInt(tick.radius), k: BigInt(tick.k), isInterior: true }));
  let reserves = fixture.initialReserves.map(BigInt);
  assert.ok(fixture.actions.some((action) => action.crossings > 0));
  for (const action of fixture.actions) {
    const result = quoteExactIn({ state: aggregateTicks(ticks), ticks, reserves, input: action.input, output: action.output, amountIn: BigInt(action.amountIn) });
    assert.equal(result.amountOut.toString(), action.amountOut);
    assert.equal(result.crossings, action.crossings);
    assert.equal(result.interiorBitmap.toString(), action.interiorBitmap);
    assert.deepEqual(result.reserves.map(String), action.reserves);
    ticks = ticks.map((tick, index) => ({ ...tick, isInterior: (result.interiorBitmap & (1n << BigInt(index))) !== 0n }));
    reserves = result.reserves;
  }
});
