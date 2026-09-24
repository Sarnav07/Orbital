import { describe, expect, it } from "vitest";
import {
  chapters,
  geometryCards,
  homePrinciples,
  problemCards,
  displayWad,
  toAmount,
} from "./App";

describe("Orbital documentation story", () => {
  it("keeps the six repository-grounded chapters in order", () => {
    expect(chapters).toHaveLength(6);
    expect(chapters.map((chapter) => chapter[1])).toEqual([
      "The split",
      "One reserve book",
      "A bounded surface",
      "Ranges hold their own claims",
      "Show the boundary",
      "Settle at the hook",
    ]);
  });

  it("formats WAD fixture values without floating point conversion", () => {
    expect(toAmount("200000000000000000000")).toBe("200.00");
    expect(toAmount("59870000000000000000")).toBe("59.87");
  });

  it("groups large sandbox amounts so 15M-scale reserves stay readable", () => {
    expect(displayWad(15_000_999_500_000_000_000_000_000n)).toBe("15,000,999.5");
    expect(displayWad(999_433_404_000_000_000_000n)).toBe("999.4334");
  });

  it("keeps the new homepage narrative grounded in the prototype", () => {
    expect(problemCards.map((card) => card[2])).toEqual([
      "Fragmented",
      "Flat",
      "Fragile",
    ]);
    expect(geometryCards.map((card) => card[0])).toEqual([
      "01 / SPHERE",
      "02 / TICKS",
      "03 / TORUS",
    ]);
    expect(homePrinciples.map((principle) => principle[1])).toEqual([
      "Shared route state",
      "Range-specific claims",
      "Observed transitions",
    ]);

    const copy = JSON.stringify([
      problemCards,
      geometryCards,
      homePrinciples,
    ]);
    expect(copy).not.toMatch(/154×|154x|guaranteed|zero slippage/i);
  });
});

describe("Unichain Sepolia deployment panel", () => {
  it("links the recorded hook, router and live swap to the block explorer", async () => {
    const { liveDeployment } = await import("./App");
    expect(liveDeployment.chainId).toBe(1301);
    expect(liveDeployment.hook.href).toBe(`https://unichain-sepolia.blockscout.com/address/${liveDeployment.hook.address}`);
    expect(liveDeployment.hook.address.toLowerCase().endsWith("2888")).toBe(true);
    expect(liveDeployment.tokens.map((token) => token.symbol).sort()).toEqual(["DAI", "FRAX", "USDC", "USDT"]);
    expect(liveDeployment.swapTx.href).toMatch(/\/tx\/0x[0-9a-f]{64}$/);
  });
});
