import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MANIFEST, deploymentReady, validateManifest } from "../src/manifest.js";

test("the committed placeholder is valid but cannot be mistaken for a deployment", () => {
  assert.equal(validateManifest(DEFAULT_MANIFEST), null);
  assert.equal(deploymentReady(DEFAULT_MANIFEST), false);
});

test("a ready deployment requires all public addresses", () => {
  const manifest = structuredClone(DEFAULT_MANIFEST);
  manifest.deployment.status = "ready";
  manifest.deployment.hookAddress = "0x0000000000000000000000000000000000000001";
  assert.match(validateManifest(manifest), /all token addresses/);
});

test("manifest validation rejects malformed faucet configuration", () => {
  const manifest = structuredClone(DEFAULT_MANIFEST);
  manifest.assets[0].faucet = { address: "not-an-address", amountRaw: "100" };
  assert.match(validateManifest(manifest), /Invalid faucet entry/);
});
