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
});
