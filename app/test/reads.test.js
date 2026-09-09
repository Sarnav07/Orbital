import test from "node:test";
import assert from "node:assert/strict";
import { addressWord, balanceOfCalldata, decodeWords, formatUnits, mintCalldata } from "../src/evm.js";
import { SELECTORS } from "../src/reads.js";

const ACCOUNT = "0x000000000000000000000000000000000000dEaD";

test("encodes standard balance and mock-token faucet calls without a library", () => {
  assert.equal(balanceOfCalldata(ACCOUNT), `0x70a08231${addressWord(ACCOUNT)}`);
  assert.equal(mintCalldata(ACCOUNT, 1_000_000n), `0x40c10f19${addressWord(ACCOUNT)}${"f4240".padStart(64, "0")}`);
});

test("decodes fixed ABI words and formats exact token units", () => {
  const data = `0x${"64".padStart(64, "0")}${"200".padStart(64, "0")}`;
  assert.deepEqual(decodeWords(data, 2), [100n, 512n]);
  assert.equal(formatUnits(1_234_567n, 6), "1.2345");
  assert.equal(formatUnits(12_000_000_000_000_000_000n, 18), "12");
});

test("keeps selectors tied to the deployed read surface", () => {
  assert.deepEqual(SELECTORS, {
    reserves: "0x75172a8b",
    tickCount: "0xb9ffc934",
    tickIsInterior: "0x98bb2238",
    sharesOf: "0xe78307ca",
    position: "0xf7a95a9e"
  });
});
