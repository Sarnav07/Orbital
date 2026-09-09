import { balanceOfCalldata, decodeWords, ethCall, formatUnits } from "./evm.js";

export const SELECTORS = Object.freeze({
  reserves: "0x75172a8b",
  tickCount: "0xb9ffc934",
  tickIsInterior: "0x98bb2238",
  sharesOf: "0xe78307ca",
  position: "0xf7a95a9e"
});

function uint256Calldata(selector, value) {
  return `${selector}${BigInt(value).toString(16).padStart(64, "0")}`;
}

function sharesOfCalldata(rangeId, account) {
  return `${uint256Calldata(SELECTORS.sharesOf, rangeId)}${account.slice(2).toLowerCase().padStart(64, "0")}`;
}

export async function readWalletBalances(provider, manifest, account) {
  const entries = await Promise.all(
    manifest.assets.map(async (asset) => {
      const raw = decodeWords(await ethCall(provider, asset.address, balanceOfCalldata(account)), 1)[0];
      return { symbol: asset.symbol, raw, display: formatUnits(raw, asset.decimals) };
    })
  );
  return entries;
}

export async function readPoolSnapshot(provider, manifest) {
  const hook = manifest.deployment.hookAddress;
  const reserveWords = decodeWords(await ethCall(provider, hook, SELECTORS.reserves), 4);
  const count = Number(decodeWords(await ethCall(provider, hook, SELECTORS.tickCount), 1)[0]);
  if (!Number.isSafeInteger(count) || count > 16) throw new RangeError("Hook returned an unsupported tick count.");
  const interiors = await Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const value = decodeWords(await ethCall(provider, hook, uint256Calldata(SELECTORS.tickIsInterior, index)), 1)[0];
      return value === 1n;
    })
  );
  return {
    reserves: manifest.assets.map((asset, index) => ({
      symbol: asset.symbol,
      raw: reserveWords[index],
      display: formatUnits(reserveWords[index], 18)
    })),
    interiors
  };
}

export async function readPositions(provider, manifest, account) {
  const book = manifest.deployment.rangeShareBookAddress;
  if (!book) return [];
  return Promise.all(
    manifest.ranges.map(async (rangeId) => {
      const [shares, position] = await Promise.all([
        ethCall(provider, book, sharesOfCalldata(rangeId, account)),
        ethCall(provider, book, uint256Calldata(SELECTORS.position, rangeId))
      ]);
      const [totalShares, ...inventory] = decodeWords(position, 5);
      return {
        rangeId,
        shares: decodeWords(shares, 1)[0],
        totalShares,
        inventory: manifest.assets.map((asset, index) => ({
          symbol: asset.symbol,
          raw: inventory[index],
          display: formatUnits(inventory[index], 18)
        }))
      };
    })
  );
}
