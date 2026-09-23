import { describe, expect, it } from "vitest";
import {
  commitPreview,
  createSandboxState,
  formatWad,
  interiorBitmap,
  parseWad,
  previewSwap,
  projectReserveImbalance,
  sampleCurve,
} from "./simulator";

describe("Orbital stateful sandbox", () => {
  it("parses and formats token amounts with BigInt WAD precision", () => {
    expect(parseWad("10.25")).toBe(10_250_000_000_000_000_000n);
    expect(formatWad(parseWad("10.2500"))).toBe("10.25");
    expect(() => parseWad("1.1234567890123456789")).toThrow("18 decimal places");
  });

  it("commits a valid exact-input quote into local reserve state", () => {
    const initial = createSandboxState();
    const preview = previewSwap(initial, 0, 1, parseWad("10"));
    const next = commitPreview(preview);

    expect(next.reserves[0]).toBe(parseWad("110"));
    expect(next.reserves[1]).toBe(parseWad("100") - preview.amountOut);
    expect(initial.reserves).toEqual([parseWad("100"), parseWad("100"), parseWad("100"), parseWad("100")]);
  });

  it("records a crossing through the same quote engine used by the sandbox", () => {
    const preview = previewSwap(createSandboxState(), 0, 1, parseWad("80"));
    expect(preview.crossings).toBe(1);
    expect(preview.interiorBitmap).toBe(2n);
    expect(preview.ticks.map((tick) => tick.isInterior)).toEqual([false, true]);
  });

  it("derives curve samples without mutating the active state", () => {
    const sandbox = createSandboxState();
    const before = sandbox.reserves.map(String);
    const curve = sampleCurve(sandbox, 0, 1);

    expect(curve.length).toBeGreaterThan(1);
    expect(curve[0].amountOut).toBeGreaterThan(0n);
    expect(curve[0].inputReserve).toBeGreaterThan(sandbox.reserves[0]);
    expect(curve[0].outputReserve).toBeLessThan(sandbox.reserves[1]);
    expect(typeof curve[0].interiorBitmap).toBe("bigint");
    expect(sandbox.reserves.map(String)).toEqual(before);
  });

  it("projects balanced and preview reserve vectors deterministically", () => {
    const sandbox = createSandboxState();
    const balanced = projectReserveImbalance(sandbox.reserves);
    const preview = previewSwap(sandbox, 0, 2, parseWad("40"));
    const moved = projectReserveImbalance(preview.reserves);

    expect(balanced).toEqual({ x: 0, y: 0, magnitude: 0 });
    expect(moved.magnitude).toBeGreaterThan(0);
    expect(Number.isFinite(moved.x)).toBe(true);
    expect(Number.isFinite(moved.y)).toBe(true);
    expect(interiorBitmap(preview.ticks)).toBe(preview.interiorBitmap);
  });
});
