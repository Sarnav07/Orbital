import { describe, expect, it } from "vitest";
import { DEPLOYMENT } from "./config";
import { initialDemoBook, minAmountOut, quoteHookSwap } from "./quote";

const index = (symbol: string) => DEPLOYMENT.symbols.indexOf(symbol);

describe("quoteHookSwap mirrors OrbitalV4Hook.beforeSwap", () => {
  it("reproduces the live Unichain Sepolia swap to the wei", () => {
    const book = initialDemoBook(DEPLOYMENT);
    const quote = quoteHookSwap(book, index("USDC"), index("DAI"), 1_000_000_000n);
    expect(quote.fee).toBe(500_000n);
    expect(quote.amountOut).toBe(999_433_404_420_670_936_920n);
    expect(quote.crossings).toBe(0);
  });

  it("rounds 18-decimal output down into 6-decimal tokens", () => {
    const book = initialDemoBook(DEPLOYMENT);
    const quote = quoteHookSwap(book, index("DAI"), index("USDT"), 1_000n * 10n ** 18n);
    expect(quote.amountOut).toBe(quote.amountOutWad / 10n ** 12n);
    expect(quote.amountOut).toBeGreaterThan(999_000_000n);
  });

  it("rejects amounts that cannot cover the fee and identical assets", () => {
    const book = initialDemoBook(DEPLOYMENT);
    expect(() => quoteHookSwap(book, 0, 1, 1n)).toThrow(/fee/);
    expect(() => quoteHookSwap(book, 2, 2, 10n)).toThrow(/different/);
  });

  it("derives a slippage-bounded minimum output", () => {
    expect(minAmountOut(1_000_000n, 50)).toBe(995_000n);
    expect(minAmountOut(1_000_000n, 0)).toBe(1_000_000n);
  });
});
