import { formatUnits, parseUnits } from "viem";
import type { Deployment } from "../chain/deployment";

/** Display metadata for the deployed mock basket; logos are the real assets' marks (Trust Wallet assets). */
const META: Record<string, { name: string; logo: string }> = {
  USDC: { name: "USD Coin", logo: "/tokens/usdc.png" },
  USDT: { name: "Tether USD", logo: "/tokens/usdt.png" },
  DAI: { name: "Dai Stablecoin", logo: "/tokens/dai.png" },
  FRAX: { name: "Frax", logo: "/tokens/frax.png" },
};

export type Token = { index: number; symbol: string; name: string; logo: string; decimals: number; address: string };

/** The pool's basket in its onchain (sorted-address) order, which differs per network. */
export function tokensFor(deployment: Deployment): Token[] {
  return deployment.symbols.map((symbol, index) => ({
    index,
    symbol,
    name: META[symbol]?.name ?? symbol,
    logo: META[symbol]?.logo ?? "",
    decimals: deployment.decimals[index],
    address: deployment.currencies[index],
  }));
}

/** Sum of amounts in 18-decimal dollars at $1 per coin (the convention for the mock basket). */
export const usdValue = (tokens: Pick<Token, "decimals">[], amounts: bigint[]) =>
  amounts.reduce((sum, amount, index) => sum + amount * 10n ** BigInt(18 - tokens[index].decimals), 0n);

/** Grouped amount for display, trimmed to at most `maxFraction` decimals. */
export function formatAmount(value: bigint, decimals: number, maxFraction = 4): string {
  const number = Number(formatUnits(value, decimals));
  if (number !== 0 && Math.abs(number) < 10 ** -maxFraction) return `<${(10 ** -maxFraction).toFixed(maxFraction)}`;
  return number.toLocaleString("en-US", { maximumFractionDigits: maxFraction });
}

/** The basket is mock stablecoins with no price feed: valued at $1 per token, as agreed for this demo. */
export function formatUsd(value: bigint, decimals: number): string {
  const number = Number(formatUnits(value, decimals));
  return `$${number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Parses a typed amount; returns null for empty, malformed or too-precise input. */
export function parseAmount(text: string, decimals: number): bigint | null {
  const trimmed = text.trim();
  if (!trimmed || !/^\d*\.?\d*$/.test(trimmed) || trimmed === ".") return null;
  if ((trimmed.split(".")[1] ?? "").length > decimals) return null;
  try {
    return parseUnits(trimmed, decimals);
  } catch {
    return null;
  }
}

export const shortAddress = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;

/** Compact dollars for tables: $14.36M, $28.1K, $950.00. */
export function formatUsdCompact(value: bigint, decimals = 18): string {
  const number = Number(formatUnits(value, decimals));
  if (number >= 1_000_000) return `$${(number / 1_000_000).toFixed(2)}M`;
  if (number >= 1_000) return `$${(number / 1_000).toFixed(1)}K`;
  return `$${number.toFixed(2)}`;
}
