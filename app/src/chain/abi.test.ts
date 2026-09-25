import { toEventSelector, toFunctionSelector, type AbiFunction } from "viem";
import { describe, expect, it } from "vitest";
import { hookAbi, routerAbi, tokenAbi } from "./abi";

// Selectors recorded from `forge inspect <Contract> methodIdentifiers` against the deployed sources.
const HOOK_SELECTORS: Record<string, string> = {
  addLiquidity: "0x154704d1",
  collectFees: "0x51f3b4bd",
  feeLiability: "0x36ebd86f",
  previewAddLiquidity: "0x1cdf2dc3",
  previewRemoveLiquidity: "0x090d45ee",
  removeLiquidity: "0xa138ab73",
  reserves: "0x75172a8b",
  seeded: "0x334041a6",
  sharesOf: "0xe78307ca",
  solvency: "0x773c5049",
  state: "0xc19d93fb",
  tickAt: "0xe2333528",
  tickCount: "0xb9ffc934",
  totalShares: "0x13f2dad0",
};

const selectorOf = (abi: readonly unknown[], name: string) =>
  toFunctionSelector((abi as AbiFunction[]).find((item) => item.type === "function" && item.name === name)!);

describe("contract ABIs match the deployed sources", () => {
  it("uses the hook's real function selectors", () => {
    for (const [name, selector] of Object.entries(HOOK_SELECTORS)) expect(selectorOf(hookAbi, name)).toBe(selector);
  });

  it("uses PoolSwapTest.swap and ERC-20 mock selectors", () => {
    expect(selectorOf(routerAbi, "swap")).toBe("0x2229d0b4");
    expect(selectorOf(tokenAbi, "balanceOf")).toBe("0x70a08231");
    expect(selectorOf(tokenAbi, "allowance")).toBe("0xdd62ed3e");
    expect(selectorOf(tokenAbi, "approve")).toBe("0x095ea7b3");
    expect(selectorOf(tokenAbi, "mint")).toBe("0x40c10f19");
  });

  it("decodes the hook's OrbitalSwap event topic", () => {
    const event = hookAbi.find((item) => item.type === "event" && item.name === "OrbitalSwap")!;
    expect(toEventSelector(event)).toBe("0x38ac5a8c0921492b76809478c3de23c0205ee8509d5bbf3c48e019b41e130827");
  });
});
