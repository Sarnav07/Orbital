import { ContractFunctionRevertedError, UserRejectedRequestError, encodeErrorResult, toFunctionSelector } from "viem";
import { describe, expect, it } from "vitest";
import { hookAbi, routerAbi } from "./abi";
import { explainRevert } from "./errors";

const hookError = (errorName: string) => encodeErrorResult({ abi: hookAbi, errorName } as never);

describe("explainRevert", () => {
  it("unwraps a PoolManager-wrapped hook revert", () => {
    const data = encodeErrorResult({
      abi: routerAbi,
      errorName: "WrappedError",
      args: ["0x10f107C223E83C0c3D43f3afe0eD75e0a06B2888", toFunctionSelector("beforeSwap(address,(address,address,uint24,int24,address),(bool,int256,uint160),bytes)"), hookError("SlippageExceeded"), toFunctionSelector("HookCallFailed()")],
    });
    const error = new ContractFunctionRevertedError({ abi: routerAbi, data, functionName: "swap" });
    expect(explainRevert(error)).toMatch(/slippage/i);
  });

  it("explains direct hook reverts and wallet rejections", () => {
    const error = new ContractFunctionRevertedError({ abi: hookAbi, data: hookError("InsufficientShares"), functionName: "removeLiquidity" });
    expect(explainRevert(error)).toMatch(/shares/i);
    expect(explainRevert(new UserRejectedRequestError(new Error("rejected")))).toMatch(/rejected/i);
    expect(explainRevert(new Error("boom"))).toBe("boom");
  });

  it("explains the unsupported all-boundary region", () => {
    const error = new ContractFunctionRevertedError({ abi: hookAbi, data: hookError("AllBoundaryUnsupported"), functionName: "swap" });
    expect(explainRevert(error)).toMatch(/every range/i);
  });
});
