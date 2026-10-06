import { describe, expect, it } from "vitest";
import type { Deployment } from "../chain/deployment";
import { tokensFor } from "./tokens";

const deployment = (symbols: string[]) => ({
  symbols,
  decimals: [6, 18, 6, 18],
  currencies: ["0x1", "0x2", "0x3", "0x4"],
}) as unknown as Deployment;

describe("tokensFor", () => {
  it("names and draws the testnet mocks as the coins they stand in for", () => {
    const [usdc, frax] = tokensFor(deployment(["USDC", "FRAX", "USDT", "DAI"]));
    expect(usdc).toMatchObject({ symbol: "USDC", name: "USD Coin", logo: "/tokens/usdc.png", demo: false });
    expect(frax).toMatchObject({ symbol: "FRAX", name: "Frax", logo: "/tokens/frax.png", demo: false });
  });

  it("keeps a mainnet demo coin's own symbol and marks it as a demo coin", () => {
    const [usdc, frax] = tokensFor(deployment(["oUSDC", "oFRAX", "oUSDT", "oDAI"]));
    expect(usdc).toMatchObject({ symbol: "oUSDC", base: "USDC", name: "Orbital demo USD Coin", logo: "/tokens/usdc.png", demo: true });
    expect(frax).toMatchObject({ symbol: "oFRAX", base: "FRAX", name: "Orbital demo Frax", demo: true });
  });
});
