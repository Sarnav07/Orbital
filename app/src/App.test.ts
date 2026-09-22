import { describe, expect, it } from "vitest";
import {
  chapters,
  geometryCards,
  homePrinciples,
  problemCards,
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

  it("keeps the new homepage narrative grounded in the prototype", () => {
    expect(problemCards.map((card) => card[2])).toEqual([
      "Fragmented",
      "Pair-local",
      "Visible",
    ]);
    expect(geometryCards.map((card) => card[0])).toEqual([
      "01 / SPHERE4",
      "02 / TICK BOUNDARY",
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
