import test from "node:test";
import assert from "node:assert/strict";
import { WorkflowError, approveExact, deadlineFrom, liquidityAvailability, minReceived, parseAmount, submitPrepared, swapAvailability } from "../src/workflows.js";
import { DEFAULT_MANIFEST } from "../src/manifest.js";

const ACCOUNT = "0x000000000000000000000000000000000000dEaD";
const TOKEN = "0x0000000000000000000000000000000000000001";
const SPENDER = "0x0000000000000000000000000000000000000002";

test("amount parsing and slippage bounds stay exact", () => {
  assert.equal(parseAmount("12.3456", 6), 12_345_600n);
  assert.equal(parseAmount("0.000001", 6), 1n);
  assert.throws(() => parseAmount("0", 6), WorkflowError);
  assert.throws(() => parseAmount("1.0000001", 6), /at most 6/);
  assert.equal(minReceived(1_000_001n, 50), 995_000n);
  assert.equal(deadlineFrom(1_700_000_000, 300), 1_700_000_300n);
  assert.throws(() => deadlineFrom(1, 12), /between 30/);
});

test("approval waits for a successful on-chain receipt", async () => {
  const requests = [];
  const provider = {
    request: async (request) => {
      requests.push(request);
      if (request.method === "eth_sendTransaction") return "0xapproved";
      if (request.method === "eth_getTransactionReceipt") return { status: "0x1", transactionHash: "0xapproved" };
      throw new Error("unexpected request");
    }
  };
  const result = await approveExact(provider, { tokenAddress: TOKEN, owner: ACCOUNT, spender: SPENDER, amountRaw: 500n });
  assert.equal(result.hash, "0xapproved");
  assert.equal(requests[0].params[0].to, TOKEN);
  assert.match(requests[0].params[0].data, /^0x095ea7b3/);
});

test("a rejected approval is never treated as a confirmed allowance", async () => {
  let receiptReads = 0;
  const provider = {
    request: async ({ method }) => {
      if (method === "eth_sendTransaction") {
        const error = new Error("User rejected the request.");
        error.code = 4001;
        throw error;
      }
      if (method === "eth_getTransactionReceipt") receiptReads += 1;
      return null;
    }
  };
  await assert.rejects(approveExact(provider, { tokenAddress: TOKEN, owner: ACCOUNT, spender: SPENDER, amountRaw: 1n }), /User rejected/);
  assert.equal(receiptReads, 0);
});

test("prepared submissions reject absent payloads and surface a reverted receipt", async () => {
  await assert.rejects(submitPrepared({}, { from: ACCOUNT }), /verified transaction payload/);
  const provider = {
    request: async ({ method }) => method === "eth_sendTransaction" ? "0xreverted" : { status: "0x0" }
  };
  await assert.rejects(submitPrepared(provider, { from: ACCOUNT, to: SPENDER, data: "0x1234" }), /reverted on-chain/);
});

test("unconfigured settlement routes cannot be mistaken for executable workflows", () => {
  assert.match(swapAvailability(DEFAULT_MANIFEST), /No verified swap router/);
  assert.match(liquidityAvailability(DEFAULT_MANIFEST), /No verified position manager/);
});
