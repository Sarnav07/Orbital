import test from "node:test";
import assert from "node:assert/strict";
import { compareObservedFrame, scenarioById, scenarioFrames } from "../src/scenarios.js";

test("pressure and recovery scenarios move reserves only through explicit modeled trades", () => {
  const pressure = scenarioFrames(scenarioById("usdt-pressure"));
  assert.equal(pressure.length, 2);
  assert.deepEqual(pressure[1].reserves, [59_876_447_197_067_751_409n, 200n * 10n ** 18n, 100n * 10n ** 18n, 100n * 10n ** 18n]);
  const recovery = scenarioFrames(scenarioById("usdt-recovery"));
  assert.equal(recovery.length, 3);
  assert.deepEqual(recovery[2].reserves, [69_876_447_197_067_751_409n, 144_611_725_013_839_770_682n, 100n * 10n ** 18n, 100n * 10n ** 18n]);
  assert.equal(recovery[2].interiorBitmap, 3n);
});

test("every committed scenario frame passes the Solidity solver drift threshold", () => {
  for (const id of ["peg", "usdt-pressure", "usdt-recovery"]) {
    for (const frame of scenarioFrames(scenarioById(id))) assert.equal(frame.inspection.isWithinSolverBound, true);
  }
});

test("confirmed comparison is exact and does not attribute a mismatch", () => {
  const expected = scenarioFrames(scenarioById("usdt-pressure"))[1];
  assert.equal(compareObservedFrame(expected, null).status, "unavailable");
  assert.equal(compareObservedFrame(expected, { reserves: expected.reserves, interiors: [false, true] }).status, "match");
  assert.equal(compareObservedFrame(expected, { reserves: expected.reserves, interiors: [true, true] }).status, "mismatch");
});
