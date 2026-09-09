export const ORBITAL_NETWORK = Object.freeze({
  chainId: 1301,
  name: "Unichain Sepolia"
});

export const DEFAULT_MANIFEST = Object.freeze({
  version: 1,
  network: ORBITAL_NETWORK,
  deployment: {
    status: "awaiting-deployment",
    hookAddress: null,
    rangeShareBookAddress: null
  },
  assets: [
    { symbol: "USDC", decimals: 6, address: null, faucet: null },
    { symbol: "USDT", decimals: 6, address: null, faucet: null },
    { symbol: "DAI", decimals: 18, address: null, faucet: null },
    { symbol: "FRAX", decimals: 18, address: null, faucet: null }
  ],
  ranges: [0, 1]
});

export function isAddress(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function validateManifest(manifest) {
  if (!manifest || manifest.version !== 1) return "Manifest version 1 is required.";
  if (!manifest.network || !Number.isInteger(manifest.network.chainId)) return "A numeric chain id is required.";
  if (!Array.isArray(manifest.assets) || manifest.assets.length !== 4) return "Exactly four assets are required.";

  const symbols = new Set();
  for (const asset of manifest.assets) {
    if (!asset || typeof asset.symbol !== "string" || symbols.has(asset.symbol)) return "Asset symbols must be unique.";
    if (!Number.isInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 18) {
      return `Invalid decimals for ${asset.symbol}.`;
    }
    if (asset.address !== null && !isAddress(asset.address)) return `Invalid address for ${asset.symbol}.`;
    if (asset.faucet !== null && (!isAddress(asset.faucet.address) || !/^\d+$/.test(asset.faucet.amountRaw))) {
      return `Invalid faucet entry for ${asset.symbol}.`;
    }
    symbols.add(asset.symbol);
  }

  if (!manifest.deployment || typeof manifest.deployment.status !== "string") return "Deployment status is required.";
  for (const field of ["hookAddress", "rangeShareBookAddress"]) {
    if (manifest.deployment[field] !== null && !isAddress(manifest.deployment[field])) {
      return `Invalid ${field}.`;
    }
  }
  if (manifest.deployment.status === "ready") {
    if (!isAddress(manifest.deployment.hookAddress) || manifest.assets.some((asset) => !isAddress(asset.address))) {
      return "A ready deployment needs a hook address and all token addresses.";
    }
  }
  return null;
}

export function deploymentReady(manifest) {
  return validateManifest(manifest) === null && manifest.deployment.status === "ready";
}
