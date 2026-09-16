import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MANIFEST } from "../src/manifest.js";
import { SELECTORS, readPoolSnapshot, readPositions, readWalletBalances } from "../src/reads.js";

const ACCOUNT = "0x000000000000000000000000000000000000dEaD";
const word = (value) => BigInt(value).toString(16).padStart(64, "0");
const words = (...values) => `0x${values.map(word).join("")}`;

function readyManifest() {
  const manifest = structuredClone(DEFAULT_MANIFEST);
  manifest.deployment.status = "ready";
  manifest.deployment.hookAddress = "0x0000000000000000000000000000000000000001";
  manifest.deployment.rangeShareBookAddress = "0x0000000000000000000000000000000000000002";
  manifest.assets.forEach((asset, index) => {
    asset.address = `0x${(index + 3).toString(16).padStart(40, "0")}`;
  });
  return manifest;
}

test("pool, wallet and position readers preserve exact raw values", async () => {
  const manifest = readyManifest();
  const provider = {
    request: async ({ method, params }) => {
      assert.equal(method, "eth_call");
      const { to, data } = params[0];
      if (to === manifest.deployment.hookAddress && data === SELECTORS.reserves) {
        return words(100n * 10n ** 18n, 99n * 10n ** 18n, 101n * 10n ** 18n, 100n * 10n ** 18n);
      }
      if (to === manifest.deployment.hookAddress && data === SELECTORS.tickCount) return words(2);
      if (to === manifest.deployment.hookAddress && data.startsWith(SELECTORS.tickIsInterior)) {
        return words(data.endsWith("0".repeat(64)) ? 1 : 0);
      }
      if (manifest.assets.some((asset) => asset.address === to) && data.startsWith("0x70a08231")) return words(1_500_000);
      if (to === manifest.deployment.rangeShareBookAddress && data.startsWith(SELECTORS.sharesOf)) return words(10n ** 18n);
      if (to === manifest.deployment.rangeShareBookAddress && data.startsWith(SELECTORS.position)) {
        return words(2n * 10n ** 18n, 10n * 10n ** 18n, 20n * 10n ** 18n, 30n * 10n ** 18n, 40n * 10n ** 18n);
      }
      throw new Error(`Unexpected read ${to} ${data}`);
    }
  };

  const [pool, balances, positions] = await Promise.all([
    readPoolSnapshot(provider, manifest),
    readWalletBalances(provider, manifest, ACCOUNT),
    readPositions(provider, manifest, ACCOUNT)
  ]);

  assert.deepEqual(pool.reserves.map((reserve) => reserve.raw), [100n * 10n ** 18n, 99n * 10n ** 18n, 101n * 10n ** 18n, 100n * 10n ** 18n]);
  assert.deepEqual(pool.interiors, [true, false]);
  assert.equal(balances[0].display, "1.5");
  assert.equal(positions[0].shares, 10n ** 18n);
  assert.deepEqual(positions[0].inventory.map((entry) => entry.raw), [10n * 10n ** 18n, 20n * 10n ** 18n, 30n * 10n ** 18n, 40n * 10n ** 18n]);
});

test("pool reader refuses a malformed tick count before allocating reads", async () => {
  const manifest = readyManifest();
  const provider = { request: async ({ params }) => (params[0].data === SELECTORS.reserves ? words(1, 1, 1, 1) : words(17)) };
  await assert.rejects(readPoolSnapshot(provider, manifest), /unsupported tick count/);
});

test("an RPC failure stays an error instead of a fabricated zero balance", async () => {
  const manifest = readyManifest();
  const provider = {
    request: async () => {
      throw new Error("RPC disconnected");
    }
  };
  await assert.rejects(readWalletBalances(provider, manifest, ACCOUNT), /RPC disconnected/);
});
