export class WalletError extends Error {}

export function chainIdFromHex(value) {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) throw new WalletError("Wallet returned an invalid chain id.");
  return Number.parseInt(value, 16);
}

export async function connectWallet(provider) {
  if (!provider?.request) throw new WalletError("No browser wallet was found.");
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || !accounts[0]) throw new WalletError("Wallet returned no account.");
  const chainId = chainIdFromHex(await provider.request({ method: "eth_chainId" }));
  return { account: accounts[0], chainId };
}

export function matchingNetwork(chainId, manifest) {
  return chainId === manifest.network.chainId;
}

export async function ethCall(provider, to, data) {
  if (!provider?.request) throw new WalletError("No browser wallet was found.");
  const result = await provider.request({ method: "eth_call", params: [{ to, data }, "latest"] });
  if (typeof result !== "string" || !/^0x(?:[0-9a-f]{2})*$/i.test(result)) {
    throw new WalletError("RPC returned malformed call data.");
  }
  return result;
}

export async function sendTransaction(provider, transaction) {
  if (!provider?.request) throw new WalletError("No browser wallet was found.");
  return provider.request({ method: "eth_sendTransaction", params: [transaction] });
}

export function padWord(value) {
  const encoded = BigInt(value).toString(16);
  if (encoded.length > 64) throw new RangeError("Value does not fit in an EVM word.");
  return encoded.padStart(64, "0");
}

export function addressWord(address) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new WalletError("Invalid EVM address.");
  return address.slice(2).toLowerCase().padStart(64, "0");
}

export function balanceOfCalldata(account) {
  return `0x70a08231${addressWord(account)}`;
}

export function mintCalldata(account, amountRaw) {
  return `0x40c10f19${addressWord(account)}${padWord(amountRaw)}`;
}

export function decodeWords(data, count) {
  const value = data.slice(2);
  if (value.length !== count * 64) throw new WalletError(`Expected ${count} ABI words, received ${value.length / 64}.`);
  return Array.from({ length: count }, (_, index) => BigInt(`0x${value.slice(index * 64, (index + 1) * 64)}`));
}

export function formatUnits(value, decimals, fractionDigits = 4) {
  const amount = BigInt(value);
  const scale = 10n ** BigInt(decimals);
  const integer = amount / scale;
  const fraction = (amount % scale).toString().padStart(decimals, "0").slice(0, fractionDigits).replace(/0+$/, "");
  return fraction ? `${integer}.${fraction}` : integer.toString();
}
