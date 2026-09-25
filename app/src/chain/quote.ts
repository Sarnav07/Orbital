import { aggregateTicks, quoteExactIn } from "../../../packages/simulator/src/quote.js";
import type { Deployment } from "./config";

export type RangeTick = { radius: bigint; k: bigint; isInterior: boolean };
/** The on-chain state a quote needs: WAD reserve coordinates, range ticks, token decimals and fee pips. */
export type QuoteBook = { reserves: bigint[]; ticks: RangeTick[]; decimals: number[]; fee: bigint };
export type HookQuote = {
  amountIn: bigint;
  fee: bigint;
  amountOut: bigint;
  amountOutWad: bigint;
  crossings: number;
  reserves: bigint[];
  interiorBitmap: bigint;
};

const FEE_DENOMINATOR = 1_000_000n;
const INT128_MAX = (1n << 127n) - 1n;
const RADIUS = 10_000_000n * 10n ** 18n;
const scale = (decimals: number) => 10n ** BigInt(18 - decimals);

/** The deployed demo book before any swap (mirrors OrbitalDemoConfig). */
export function initialDemoBook(deployment: Deployment): QuoteBook {
  const equal = RADIUS * 3n / 2n;
  return {
    reserves: [equal, equal, equal, equal],
    ticks: [1001n, 1004n, 1050n].map((permille) => ({ radius: RADIUS, k: RADIUS * permille / 1000n, isInterior: true })),
    decimals: deployment.decimals,
    fee: BigInt(deployment.fee),
  };
}

/**
 * Exact mirror of OrbitalV4Hook.beforeSwap for raw token amounts: the fee is
 * rounded up in raw input units, the net input converts to WAD exactly, the
 * BigInt engine prices it, and the output rounds down into raw output units.
 */
export function quoteHookSwap(book: QuoteBook, input: number, output: number, amountIn: bigint): HookQuote {
  if (input === output) throw new Error("Choose two different stablecoins.");
  if (amountIn <= 0n) throw new Error("Enter an amount greater than zero.");
  if (amountIn > INT128_MAX) throw new Error("Amount is too large for a v4 swap.");
  const fee = (amountIn * book.fee + FEE_DENOMINATOR - 1n) / FEE_DENOMINATOR;
  if (amountIn <= fee) throw new Error("Amount must exceed the swap fee.");
  const ticks = book.ticks.map((tick) => ({ ...tick }));
  const result = quoteExactIn({
    state: aggregateTicks(ticks),
    ticks,
    reserves: book.reserves,
    input,
    output,
    amountIn: (amountIn - fee) * scale(book.decimals[input]),
  });
  return {
    amountIn,
    fee,
    amountOut: result.amountOut / scale(book.decimals[output]),
    amountOutWad: result.amountOut,
    crossings: result.crossings,
    reserves: result.reserves,
    interiorBitmap: result.interiorBitmap,
  };
}

export const minAmountOut = (amountOut: bigint, slippageBps: number) =>
  amountOut * BigInt(10_000 - slippageBps) / 10_000n;
