import { ContractFunctionRevertedError, UserRejectedRequestError, encodeErrorResult, parseAbi, toFunctionSelector } from "viem";
import { describe, expect, it } from "vitest";
import { hookAbi, routerAbi } from "./abi";
import { explainRevert } from "./errors";

const hookError = (errorName: string) => encodeErrorResult({ abi: hookAbi, errorName } as never);
const reverted = (abi: readonly unknown[], data: `0x${string}`) =>
  new ContractFunctionRevertedError({ abi: abi as never, data, functionName: "swap" });

describe("explainRevert", () => {
  it("unwraps a PoolManager-wrapped hook revert", () => {
    const data = encodeErrorResult({
      abi: routerAbi,
      errorName: "WrappedError",
      args: ["0x5fe242b3544Dd0d30C395843dE75A2B8d4dBA888", toFunctionSelector("beforeSwap(address,(address,address,uint24,int24,address),(bool,int256,uint160),bytes)"), hookError("SlippageExceeded"), toFunctionSelector("HookCallFailed()")],
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

  // Audit A-6: every error gets plain words, and generic reverts keep their reason.
  it("explains a range whose inventory would go negative", () => {
    expect(explainRevert(reverted(hookAbi, hookError("NegativeRealInventory")))).toMatch(/range/i);
  });

  it("explains every hook error in plain words, never the raw name", () => {
    for (const item of hookAbi.filter((entry) => entry.type === "error")) {
      if (item.inputs.length) continue;
      expect(explainRevert(reverted(hookAbi, hookError(item.name))), item.name).not.toMatch(/rejected the transaction \(/);
    }
  });

  it("keeps a require() reason and a panic code instead of '(Error)' or '(Panic)'", () => {
    const solidity = parseAbi(["error Error(string)", "error Panic(uint256)"]);
    const reason = encodeErrorResult({ abi: solidity, errorName: "Error", args: ["TRANSFER_FROM_FAILED"] });
    expect(explainRevert(reverted(hookAbi, reason))).toContain("TRANSFER_FROM_FAILED");
    const panic = encodeErrorResult({ abi: solidity, errorName: "Panic", args: [0x11n] });
    expect(explainRevert(reverted(hookAbi, panic))).toMatch(/overflow|0x11/i);
  });
});
