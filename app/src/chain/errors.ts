import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError, decodeErrorResult, type Hex } from "viem";
import { hookAbi } from "./abi";

const MESSAGES: Record<string, string> = {
  SlippageExceeded: "Price moved beyond your slippage limit, so nothing was traded.",
  Expired: "The transaction deadline passed before it was mined.",
  AllBoundaryUnsupported: "This trade would trap every range at its boundary, which the prototype does not support. Try a smaller amount.",
  TooManyCrossings: "This trade crosses too many range boundaries. Try a smaller amount.",
  InsufficientInventory: "The book does not hold enough real inventory for this output.",
  InsufficientOutputReserve: "The output reserve cannot cover this trade.",
  NoPhysicalRoot: "No valid price exists for this trade size. Try a smaller amount.",
  CrossingNoRoot: "No valid crossing price exists for this trade size. Try a smaller amount.",
  InsufficientShares: "You do not hold enough shares of this range.",
  NotSeeded: "The pool has not been funded yet.",
  ExactOutputUnsupported: "Only exact-input swaps are supported.",
  ZeroAmount: "The amount is too small after the swap fee.",
  UnsupportedPool: "That pool key does not belong to this Orbital hook.",
  TransferFailed: "A token transfer failed. Check your balance and approvals.",
  InvariantViolation: "This liquidity change would break the pool invariant. Try a different size.",
  InvalidRange: "That range change is not possible.",
};

const describe = (name: string) => MESSAGES[name] ?? `The contract rejected the transaction (${name}).`;

/** Human-readable reason for a failed simulation or transaction, unwrapping v4 WrappedError. */
export function explainRevert(error: unknown): string {
  if (error instanceof BaseError) {
    if (error.walk((cause) => cause instanceof UserRejectedRequestError)) return "You rejected the request in your wallet.";
    const reverted = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError && reverted.data) {
      const { errorName, args } = reverted.data;
      if (errorName === "WrappedError" && args) {
        try {
          const inner = decodeErrorResult({ abi: hookAbi, data: args[2] as Hex });
          return describe(inner.errorName);
        } catch {
          return "The hook rejected the swap.";
        }
      }
      if (errorName) return describe(errorName);
    }
    return error.shortMessage;
  }
  return error instanceof Error ? error.message : "The transaction failed.";
}
