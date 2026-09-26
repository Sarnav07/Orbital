import { describe, expect, it, vi } from "vitest";
import { ensureChain, watchWallets, type Eip1193Provider } from "./wallet";

const provider = (handler: (method: string, params?: unknown[]) => unknown): Eip1193Provider => ({
  request: vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => handler(method, params)),
});

describe("wallet discovery and network guard", () => {
  it("collects EIP-6963 announcements once per wallet and falls back to window.ethereum", () => {
    const target = new EventTarget() as EventTarget & { ethereum?: Eip1193Provider };
    const seen: string[][] = [];
    const rabby = provider(() => null);
    target.addEventListener("eip6963:requestProvider", () => {
      const detail = { info: { uuid: "1", name: "Rabby", icon: "data:", rdns: "io.rabby" }, provider: rabby };
      target.dispatchEvent(Object.assign(new Event("eip6963:announceProvider"), { detail }));
      target.dispatchEvent(Object.assign(new Event("eip6963:announceProvider"), { detail }));
    });
    const stop = watchWallets((wallets) => seen.push(wallets.map((wallet) => wallet.info.name)), target);
    expect(seen.at(-1)).toEqual(["Rabby"]);
    stop();

    const legacy = new EventTarget() as EventTarget & { ethereum?: Eip1193Provider };
    legacy.ethereum = provider(() => null);
    const names: string[][] = [];
    watchWallets((wallets) => names.push(wallets.map((wallet) => wallet.info.name)), legacy)();
    expect(names.at(-1)).toEqual(["Browser wallet"]);
  });

  it("switches networks and adds Unichain Sepolia when the wallet does not know it", async () => {
    const calls: string[] = [];
    let added = false;
    const wallet = provider((method) => {
      calls.push(method);
      if (method === "wallet_switchEthereumChain" && !added) throw Object.assign(new Error("Unrecognized chain"), { code: 4902 });
      if (method === "wallet_addEthereumChain") added = true;
      return null;
    });
    await ensureChain(wallet);
    expect(calls).toEqual(["wallet_switchEthereumChain", "wallet_addEthereumChain", "wallet_switchEthereumChain"]);
    const addParams = (wallet.request as ReturnType<typeof vi.fn>).mock.calls[1][0].params[0];
    expect(addParams.chainId).toBe("0x515");
    expect(addParams.rpcUrls[0]).toMatch(/^https:/);
  });

  it("switches to the requested network and adds it with that network's RPC and explorer", async () => {
    const { networkByKey } = await import("./networks");
    const arc = networkByKey("arc-testnet");
    const calls: Array<{ method: string; params: Array<Record<string, any>> }> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    const wallet = provider((method, params) => {
      calls.push({ method, params: params as Array<Record<string, unknown>> });
      if (method === "wallet_switchEthereumChain" && !calls.some((call) => call.method === "wallet_addEthereumChain")) throw Object.assign(new Error("Unrecognized chain"), { code: 4902 });
      return null;
    });
    await ensureChain(wallet, arc);
    expect(calls[0].params[0].chainId).toBe("0x4cef52");
    const added = calls.find((call) => call.method === "wallet_addEthereumChain")!.params[0];
    expect(added.chainName).toBe("Arc Testnet");
    expect(added.nativeCurrency.symbol).toBe("USDC");
    expect(added.blockExplorerUrls[0]).toBe("https://testnet.arcscan.app");
  });
});
