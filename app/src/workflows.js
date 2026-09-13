import { allowanceCalldata, approveCalldata, decodeWords, ethCall, sendTransaction, waitForReceipt } from "./evm.js";

export class WorkflowError extends Error {}

export function parseAmount(value, decimals) {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value)) throw new WorkflowError("Enter a positive decimal amount.");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new WorkflowError(`This asset supports at most ${decimals} decimal places.`);
  const raw = BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals));
  if (raw <= 0n) throw new WorkflowError("Amount must be greater than zero.");
  return raw;
}

export function minReceived(quotedAmountOut, slippageBps) {
  const quote = BigInt(quotedAmountOut);
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) {
    throw new WorkflowError("Slippage must be between 0 and 10,000 basis points.");
  }
  return quote * BigInt(10_000 - slippageBps) / 10_000n;
}

export function deadlineFrom(nowSeconds, durationSeconds) {
  if (!Number.isInteger(nowSeconds) || !Number.isInteger(durationSeconds) || durationSeconds < 30 || durationSeconds > 3600) {
    throw new WorkflowError("Deadline must be between 30 seconds and one hour.");
  }
  return BigInt(nowSeconds + durationSeconds);
}

export function swapAvailability(manifest) {
  if (!manifest.deployment.swapRouterAddress) return "No verified swap router is configured.";
  return null;
}

export function liquidityAvailability(manifest) {
  if (!manifest.deployment.positionManagerAddress) return "No verified position manager is configured.";
  return null;
}

export async function readAllowance(provider, tokenAddress, owner, spender) {
  return decodeWords(await ethCall(provider, tokenAddress, allowanceCalldata(owner, spender)), 1)[0];
}

export async function approveExact(provider, { tokenAddress, owner, spender, amountRaw }) {
  const hash = await sendTransaction(provider, {
    from: owner,
    to: tokenAddress,
    data: approveCalldata(spender, amountRaw)
  });
  const receipt = await waitForReceipt(provider, hash);
  return { hash, receipt };
}

export async function submitPrepared(provider, { from, to, data, value = "0x0" }) {
  if (!to || !data) throw new WorkflowError("No verified transaction payload is available.");
  const hash = await sendTransaction(provider, { from, to, data, value });
  const receipt = await waitForReceipt(provider, hash);
  return { hash, receipt };
}
