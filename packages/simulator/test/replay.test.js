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
