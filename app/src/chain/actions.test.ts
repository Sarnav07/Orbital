import { decodeAbiParameters, maxUint256 } from "viem";
import { describe, expect, it } from "vitest";
import { MAX_PRICE_LIMIT, MIN_PRICE_LIMIT, addLiquidityRequest, approveRequest, collectFeesRequest, mintRequest, poolKey, removeLiquidityRequest, swapRequest } from "./actions";
import { DEPLOYMENT } from "./config";

const account = "0x000000000000000000000000000000000000dEaD" as const;

describe("transaction builders", () => {
  it("orders pool keys canonically with the hook's fee and spacing", () => {
    const key = poolKey(DEPLOYMENT, 3, 0);
    expect(BigInt(key.currency0) < BigInt(key.currency1)).toBe(true);
    expect(key.fee).toBe(500);
    expect(key.tickSpacing).toBe(60);
    expect(key.hooks).toBe(DEPLOYMENT.hook);
  });

  it("builds an exact-input router swap with min-out and deadline hook data", () => {
    const request = swapRequest(DEPLOYMENT, { input: 3, output: 2, amountIn: 1_000_000_000n, minAmountOut: 990n, deadline: 1_700_000_000n });
    const [key, params, settings, hookData] = request.args;
    expect(request.address).toBe(DEPLOYMENT.router);
    expect(request.functionName).toBe("swap");
    expect(key.currency0).toBe(DEPLOYMENT.currencies[2]);
    expect(params.zeroForOne).toBe(false);
    expect(params.amountSpecified).toBe(-1_000_000_000n);
    expect(params.sqrtPriceLimitX96).toBe(MAX_PRICE_LIMIT);
    expect(settings).toEqual({ takeClaims: false, settleUsingBurn: false });
    expect(decodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], hookData)).toEqual([990n, 1_700_000_000n]);

    const forward = swapRequest(DEPLOYMENT, { input: 0, output: 1, amountIn: 5n, minAmountOut: 0n, deadline: 1n });
    expect(forward.args[1].zeroForOne).toBe(true);
    expect(forward.args[1].sqrtPriceLimitX96).toBe(MIN_PRICE_LIMIT);
  });

  it("builds token, liquidity and fee requests against the right contracts", () => {
    expect(mintRequest(DEPLOYMENT, 1, account, 7n)).toMatchObject({ address: DEPLOYMENT.currencies[1], functionName: "mint", args: [account, 7n] });
    expect(approveRequest(DEPLOYMENT, 2, DEPLOYMENT.router)).toMatchObject({ address: DEPLOYMENT.currencies[2], functionName: "approve", args: [DEPLOYMENT.router, maxUint256] });
    expect(addLiquidityRequest(DEPLOYMENT, 1, 10n, [1n, 2n, 3n, 4n], 9n)).toMatchObject({ address: DEPLOYMENT.hook, functionName: "addLiquidity", args: [1n, 10n, [1n, 2n, 3n, 4n], 9n] });
    expect(removeLiquidityRequest(DEPLOYMENT, 1, 10n, [0n, 0n, 0n, 0n], 9n)).toMatchObject({ functionName: "removeLiquidity", args: [1n, 10n, [0n, 0n, 0n, 0n], 9n] });
    expect(collectFeesRequest(DEPLOYMENT, 2, account)).toMatchObject({ functionName: "collectFees", args: [2n, account] });
  });
});
