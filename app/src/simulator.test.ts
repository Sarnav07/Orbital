import { describe, expect, it } from "vitest";
import {
  POOL_FEE_PIPS,
  commitPreview,
  createSandboxState,
  effectiveRate,
  formatWad,
  interiorBitmap,
  maxQuotableInput,
  parseWad,
  previewSwap,
  projectReserveImbalance,
  sampleCurve,
  swapFee,
} from "./simulator";

const EQUAL = parseWad("15000000");

describe("Orbital stateful sandbox", () => {
  it("parses and formats token amounts with BigInt WAD precision", () => {
    expect(parseWad("10.25")).toBe(10_250_000_000_000_000_000n);
    expect(formatWad(parseWad("10.2500"))).toBe("10.25");
    expect(() => parseWad("1.1234567890123456789")).toThrow("18 decimal places");
  });

  it("starts from the deployed demo basket: three 10M ranges at the equal-price point", () => {
    const sandbox = createSandboxState();
    expect(sandbox.ticks.map((tick) => formatWad(tick.k * 1000n / tick.radius * 10n ** 15n, 3))).toEqual(["1.001", "1.004", "1.05"]);
    expect(sandbox.reserves).toEqual([EQUAL, EQUAL, EQUAL, EQUAL]);
  });

  it("charges the hook's input fee before quoting, like the on-chain adapter", () => {
    const amountIn = parseWad("1000");
    const fee = swapFee(amountIn);
    expect(POOL_FEE_PIPS).toBe(500n);
    expect(fee).toBe(parseWad("0.5"));

    const preview = previewSwap(createSandboxState(), 0, 2, amountIn);
    expect(preview.fee).toBe(fee);
    expect(preview.amountOut).toBeGreaterThan(parseWad("999.4"));
    expect(preview.amountOut).toBeLessThan(parseWad("999.5"));

    const next = commitPreview(preview);
    expect(next.reserves[0]).toBe(EQUAL + amountIn - fee);
    expect(next.reserves[2]).toBe(EQUAL - preview.amountOut);
  });

  it("records a crossing through the same quote engine used by the sandbox", () => {
    const preview = previewSwap(createSandboxState(), 0, 2, parseWad("1500000"));
    expect(preview.crossings).toBe(1);
    expect(preview.interiorBitmap).toBe(6n);
    expect(preview.ticks.map((tick) => tick.isInterior)).toEqual([false, true, true]);
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
    const preview = previewSwap(sandbox, 0, 2, parseWad("400000"));
    const moved = projectReserveImbalance(preview.reserves);

    expect(balanced).toEqual({ x: 0, y: 0, magnitude: 0 });
    expect(moved.magnitude).toBeGreaterThan(0);
    expect(Number.isFinite(moved.x)).toBe(true);
    expect(Number.isFinite(moved.y)).toBe(true);
    expect(interiorBitmap(preview.ticks)).toBe(preview.interiorBitmap);
  });

  it("finds the largest whole-token input the current state can quote", () => {
    const sandbox = createSandboxState();
    const max = maxQuotableInput(sandbox, 0, 2);
    expect(max).toBeGreaterThan(parseWad("1000000"));
    expect(() => previewSwap(sandbox, 0, 2, max)).not.toThrow();
    expect(() => previewSwap(sandbox, 0, 2, max + parseWad("1"))).toThrow();
  });

  it("reports no effective rate until a quote exists", () => {
    expect(effectiveRate(undefined, undefined)).toBeNull();
    const preview = previewSwap(createSandboxState(), 0, 1, parseWad("100"));
    expect(effectiveRate(preview, parseWad("100"))).toBeGreaterThan(0.999);
  });
});
