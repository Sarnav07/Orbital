import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError, decodeErrorResult, type Hex } from "viem";
import { hookAbi } from "./abi";

const TRY_SMALLER = "Try a smaller amount.";
const INTERNAL = "The pool's math rejected this state. Try a different amount; if it keeps happening, the pool may need attention.";

/** Every custom error the hook, its engine and the v4 router can raise, in plain words. */
const MESSAGES: Record<string, string> = {
  // Guards the user controls.
  SlippageExceeded: "Price moved beyond your slippage limit, so nothing was traded.",
  Expired: "The transaction deadline passed before it was mined.",
  ExactOutputUnsupported: "Only exact-input swaps are supported.",
  ZeroAmount: "The amount is too small after the swap fee.",
  ZeroAmountIn: "Enter an amount greater than zero.",
  AmountTooLarge: "That amount is too large for a single v4 swap.",
  AmountOverflow: "That amount is too large to convert into the pool's units.",
  SameAsset: "Choose two different coins.",
  InsufficientShares: "You do not hold enough shares of this range.",
  InvalidRange: "That range change is not possible.",
  TransferFailed: "A token transfer failed. Check your balance and approvals.",
  InvalidHookData: "The swap's slippage and deadline data were malformed.",
  // Liquidity limits of the book.
  AllBoundaryUnsupported: "This trade would push every range to its boundary, which the prototype does not support. " + TRY_SMALLER,
  TooManyCrossings: "This trade crosses too many range boundaries. " + TRY_SMALLER,
  InsufficientInventory: "The book does not hold enough real inventory for this output. " + TRY_SMALLER,
  InsufficientOutputReserve: "The output reserve cannot cover this trade. " + TRY_SMALLER,
  NoPhysicalRoot: "No valid price exists for this trade size. " + TRY_SMALLER,
  CrossingNoRoot: "No valid price exists where this trade crosses a range boundary. " + TRY_SMALLER,
  CrossingNoProgress: "The trade could not advance past a range boundary. " + TRY_SMALLER,
  CrossingOutputInvalid: "The trade would need a negative output at a range boundary. " + TRY_SMALLER,
  InvariantDrift: "The quote drifted off the pool's curve. " + TRY_SMALLER,
  InvariantViolation: "This liquidity change would break the pool invariant. Try a different size.",
  NegativeRealInventory: "A range's real inventory would go below zero, so this liquidity change is not possible right now.",
  AttributionUnavailable: "Range inventories cannot be attributed in the book's current state.",
  // Pool setup and access.
  NotSeeded: "The pool has not been funded yet.",
  AlreadySeeded: "The pool has already been funded.",
  UnsupportedPool: "That pool key does not belong to this Orbital hook.",
  UnsupportedCurrency: "That token is not part of this pool.",
  UnsupportedCallback: "Native v4 liquidity is not accepted; use the range positions instead.",
  OnlyOwner: "Only the pool's owner can do that.",
  OnlyPoolManager: "Only the Uniswap v4 PoolManager can call that.",
  OnlyController: "Only the Orbital hook can update range shares.",
  UnsupportedDecimals: "That token uses more than 18 decimals.",
  // Internal consistency checks that should never trigger.
  AggregateMismatch: INTERNAL,
  InvalidState: INTERNAL,
  InvalidTickSet: INTERNAL,
  InvalidRangeSet: INTERNAL,
  InvalidReserve: INTERNAL,
  InvalidRadius: INTERNAL,
  InvalidBoundary: INTERNAL,
  InvalidAssetIndex: INTERNAL,
  InvalidInitialState: INTERNAL,
  InvalidCurrencySet: INTERNAL,
  InvalidFee: INTERNAL,
  InvalidManager: INTERNAL,
  InvalidWeights: INTERNAL,
  DivisionByZero: INTERNAL,
  MulDivOverflow: INTERNAL,
  // v4 router and PoolManager.
  HookCallFailed: "The Orbital hook rejected the swap.",
  NoSwapOccurred: "The router did not execute a swap.",
  CurrencyNotSettled: "A token payment did not settle with the PoolManager. Check your balance and approvals.",
};

const PANICS: Record<string, string> = {
  "1": "assertion failed",
  "17": "arithmetic overflow or underflow (0x11)",
  "18": "division by zero (0x12)",
  "50": "array index out of bounds (0x32)",
};

function describe(name: string, args?: readonly unknown[]): string {
  if (name === "Error" && typeof args?.[0] === "string") return `The contract rejected the transaction: ${args[0]}.`;
  if (name === "Panic" && args?.[0] !== undefined) {
    const code = String(args[0]);
    return `The contract stopped with a panic: ${PANICS[code] ?? `code 0x${BigInt(code).toString(16)}`}.`;
  }
  return MESSAGES[name] ?? `The contract rejected the transaction (${name}).`;
}

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
          return describe(inner.errorName, inner.args);
        } catch {
          return "The hook rejected the swap.";
        }
      }
      if (errorName) return describe(errorName, args);
    }
    return error.shortMessage;
  }
  return error instanceof Error ? error.message : "The transaction failed.";
}
