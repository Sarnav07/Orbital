import { encodeAbiParameters, maxUint256, type Address } from "viem";
import { hookAbi, routerAbi, tokenAbi } from "./abi";
import type { Deployment } from "./config";

export const MIN_PRICE_LIMIT = 4_295_128_740n;
export const MAX_PRICE_LIMIT = 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_341n;

type Four = readonly [bigint, bigint, bigint, bigint];

export function poolKey(deployment: Deployment, a: number, b: number) {
  const [first, second] = [deployment.currencies[a], deployment.currencies[b]];
  const [currency0, currency1] = BigInt(first) < BigInt(second) ? [first, second] : [second, first];
  return { currency0, currency1, fee: deployment.fee, tickSpacing: deployment.tickSpacing, hooks: deployment.hook };
}

export function swapRequest(
  deployment: Deployment,
  swap: { input: number; output: number; amountIn: bigint; minAmountOut: bigint; deadline: bigint },
) {
  const zeroForOne = BigInt(deployment.currencies[swap.input]) < BigInt(deployment.currencies[swap.output]);
  return {
    address: deployment.router,
    abi: routerAbi,
    functionName: "swap" as const,
    args: [
      poolKey(deployment, swap.input, swap.output),
      { zeroForOne, amountSpecified: -swap.amountIn, sqrtPriceLimitX96: zeroForOne ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT },
      { takeClaims: false, settleUsingBurn: false },
      encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [swap.minAmountOut, swap.deadline]),
    ] as const,
  };
}

export const mintRequest = (deployment: Deployment, asset: number, to: Address, amount: bigint) => ({
  address: deployment.currencies[asset], abi: tokenAbi, functionName: "mint" as const, args: [to, amount] as const,
});

export const approveRequest = (deployment: Deployment, asset: number, spender: Address, amount = maxUint256) => ({
  address: deployment.currencies[asset], abi: tokenAbi, functionName: "approve" as const, args: [spender, amount] as const,
});

export const addLiquidityRequest = (deployment: Deployment, rangeId: number, shares: bigint, maxAmountsIn: Four, deadline: bigint) => ({
  address: deployment.hook, abi: hookAbi, functionName: "addLiquidity" as const,
  args: [BigInt(rangeId), shares, maxAmountsIn, deadline] as const,
});

export const removeLiquidityRequest = (deployment: Deployment, rangeId: number, shares: bigint, minAmountsOut: Four, deadline: bigint) => ({
  address: deployment.hook, abi: hookAbi, functionName: "removeLiquidity" as const,
  args: [BigInt(rangeId), shares, minAmountsOut, deadline] as const,
});

export const collectFeesRequest = (deployment: Deployment, rangeId: number, recipient: Address) => ({
  address: deployment.hook, abi: hookAbi, functionName: "collectFees" as const, args: [BigInt(rangeId), recipient] as const,
});
