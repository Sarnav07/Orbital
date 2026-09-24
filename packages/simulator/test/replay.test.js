import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertParity, replay } from "../src/replay.js";

const fixture = JSON.parse(readFileSync(new URL("../../fixtures/segmented-wad-v1.json", import.meta.url)));

test("replays the committed crossing trace with exact BigInt WAD values", () => {
  assert.deepEqual(assertParity(fixture.trace, fixture.expected), fixture.expected);
});

test("rejects a transition that spends the full output reserve", () => {
  const bad = structuredClone(fixture.trace);
  bad.actions[0].amountOut = bad.initialReserves[1];
  assert.throws(() => replay(bad), /invalid action/);
});

test("recomputes every transition and rejects a plausible but wrong amountOut", () => {
  const bad = structuredClone(fixture.trace);
  bad.actions[0].amountOut = (BigInt(bad.actions[0].amountOut) + 1n).toString();
  assert.throws(() => replay(bad), /does not match the quote engine/);
});

test("rejects a transition whose recorded tick bitmap disagrees with the engine", () => {
  const bad = structuredClone(fixture.trace);
  bad.actions[0].interiorBitmap = "3";
  assert.throws(() => replay(bad), /does not match the quote engine/);
});
