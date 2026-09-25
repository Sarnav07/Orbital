// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveApp, type LiveServices } from "./LiveApp";
import { DEPLOYMENT } from "./chain/config";
import { initialDemoBook } from "./chain/quote";
import type { AccountState, LiveBook } from "./chain/reads";

const symbolIndex = (symbol: string) => DEPLOYMENT.symbols.indexOf(symbol);
const book: LiveBook = {
  ...initialDemoBook(DEPLOYMENT),
  custody: DEPLOYMENT.decimals.map((decimals) => 3_590_186n * 10n ** BigInt(decimals)),
  required: DEPLOYMENT.decimals.map((decimals) => 3_590_186n * 10n ** BigInt(decimals)),
  feeLiability: [0n, 0n, 0n, 0n],
  totalShares: [10n ** 25n, 10n ** 25n, 10n ** 25n],
  solvent: true,
};
const emptyAccount: AccountState = {
  balances: [0n, 0n, 0n, 0n],
  routerAllowances: [0n, 0n, 0n, 0n],
  hookAllowances: [0n, 0n, 0n, 0n],
  shares: [0n, 0n, 0n],
  pendingFees: [[0n, 0n, 0n, 0n], [0n, 0n, 0n, 0n], [0n, 0n, 0n, 0n]],
};

function services(account: AccountState = emptyAccount): LiveServices {
  return {
    readBook: vi.fn(async () => book),
    readAccount: vi.fn(async () => account),
    readRecentSwaps: vi.fn(async () => ({
      ok: true,
      latest: 100n,
      swaps: [{ input: symbolIndex("USDC"), output: symbolIndex("DAI"), amountIn: 1_000_000_000n, amountOut: 999_433_404_420_670_936_920n, fee: 500_000n, crossings: 0n, hash: "0x23e33f62af47efb078152ae5d8ef18b144f65771b6bc2cf87c7414c353e19e46" as const, blockNumber: 99n }],
    })),
    readSwapsBetween: vi.fn(async () => []),
    blockNumber: vi.fn(async () => 100n),
    previewLiquidity: vi.fn(async () => [1n, 1n, 1n, 1n]),
    send: vi.fn(async () => "0x01" as const),
    waitForReceipt: vi.fn(async () => "success" as const),
  };
}

type Host = EventTarget & { ethereum?: unknown };
const walletHost = (chainId = "0x515"): Host => {
  const host = new EventTarget() as Host;
  const provider = {
    request: vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_requestAccounts") return ["0x000000000000000000000000000000000000bEEF"];
      if (method === "eth_chainId") return chainId;
      return null;
    }),
    on: vi.fn(),
    removeListener: vi.fn(),
  };
  host.addEventListener("eip6963:requestProvider", () => {
    host.dispatchEvent(Object.assign(new Event("eip6963:announceProvider"), { detail: { info: { uuid: "w", name: "Rabby", icon: "", rdns: "io.rabby" }, provider } }));
  });
  return host;
};

let container: HTMLDivElement;
let root: Root;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const button = (text: string) => [...container.querySelectorAll("button")].find((node) => node.textContent?.includes(text));
const typeAmount = (value: string) => {
  const input = container.querySelector<HTMLInputElement>("input[aria-label='Testnet swap amount']")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

describe("live Unichain Sepolia app", () => {
  it("shows the live book, ranges and recent swaps without a wallet", async () => {
    await act(async () => root.render(<LiveApp services={services()} walletHost={new EventTarget()} />));
    await flush();
    const text = container.textContent ?? "";
    expect(text).toContain("No wallet detected");
    expect(text).toContain("3,590,186");
    expect(text).toMatch(/INTERIOR/);
    expect(text).toContain("SOLVENT");
    const recent = [...container.querySelectorAll("a")].find((link) => link.href.includes("0x23e33f62"));
    expect(recent).toBeTruthy();
  });

  it("quotes swaps exactly against the live book", async () => {
    await act(async () => root.render(<LiveApp services={services()} walletHost={new EventTarget()} />));
    await flush();
    act(() => button("USDC")!.click());
    const receive = [...container.querySelectorAll(".testnet-swap .asset-picker")][1];
    act(() => [...receive.querySelectorAll("button")].find((node) => node.textContent === "DAI")!.click());
    typeAmount("1000");
    expect(container.textContent).toContain("999.4334");
    expect(button("Connect a wallet to swap")?.disabled).toBe(true);
  });

  it("connects an EIP-6963 wallet and walks the swap through mint and approve steps", async () => {
    const account = { ...emptyAccount, balances: [0n, 0n, 0n, 0n] };
    await act(async () => root.render(<LiveApp services={services(account)} walletHost={walletHost()} />));
    await flush();
    await act(async () => button("Connect Rabby")!.click());
    await flush();
    expect(container.textContent).toContain("0x0000…bEEF");
    typeAmount("100");
    expect(button("Mint test tokens first")).toBeTruthy();
  });

  it("asks to switch networks when the wallet is elsewhere", async () => {
    await act(async () => root.render(<LiveApp services={services()} walletHost={walletHost("0x1")} />));
    await flush();
    await act(async () => button("Connect Rabby")!.click());
    await flush();
    expect(button("Switch to Unichain Sepolia")).toBeTruthy();
  });
});
