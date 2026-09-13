import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertParity } from "../../packages/simulator/src/replay.js";
import { formatWad, pairSlice, replayFrames, tickSummary, tickVirtualOffset, triangleProjection } from "../src/geometry.js";
import { SEGMENTED_WAD_V1 } from "../src/replay-fixture.js";

const WAD = 10n ** 18n;
const committedFixture = JSON.parse(readFileSync(new URL("../../packages/fixtures/segmented-wad-v1.json", import.meta.url)));

test("browser replay fixture stays byte-for-byte aligned with C14's committed trace", () => {
  assert.deepEqual(SEGMENTED_WAD_V1, committedFixture.trace);
  assert.deepEqual(assertParity(SEGMENTED_WAD_V1, committedFixture.expected), committedFixture.expected);
});

test("replay frames preserve initial and crossed reserve states", () => {
  const frames = replayFrames(SEGMENTED_WAD_V1);
  assert.equal(frames.length, 2);
  assert.deepEqual(frames[0].reserves, [100n * WAD, 100n * WAD, 100n * WAD, 100n * WAD]);
  assert.deepEqual(frames[1].reserves, [200n * WAD, 59_876_447_197_067_751_409n, 100n * WAD, 100n * WAD]);
  assert.equal(frames[1].interiorBitmap, 2n);
});

test("teaching projections and pair slices are derived from the selected frame", () => {
  const projection = triangleProjection([200n * WAD, 100n * WAD, 100n * WAD, 100n * WAD]);
  assert.equal(projection.shares[0], 0.5);
  assert.equal(projection.shares[1], 0.25);
  const slice = pairSlice([200n * WAD, 59_876_447_197_067_751_409n, 100n * WAD, 100n * WAD], 0, 1);
  assert.equal(slice.input.display, "200");
  assert.equal(slice.output.display, "59.87");
});

test("tick floor display follows Sphere4's floored virtual-offset geometry", () => {
  const offset = tickVirtualOffset(14n * WAD, 15n * WAD);
  assert.ok(offset >= 3n * WAD - 2n && offset <= 3n * WAD + 2n);
  assert.equal(tickSummary().length, 2);
  assert.equal(formatWad(3_140_000_000_000_000_000n), "3.14");
});
