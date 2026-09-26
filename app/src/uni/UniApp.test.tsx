// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEPLOYMENT } from "../chain/config";
import { initialDemoBook } from "../chain/quote";
import type { AccountState, LiveBook } from "../chain/reads";
import type { LiveServices, PoolStatsReader } from "./services";
import type { ServicesProp } from "./state";
import { UniApp } from "./UniApp";

const idx = (symbol: string) => DEPLOYMENT.symbols.indexOf(symbol);
const units = (symbol: string, amount: bigint) => amount * 10n ** BigInt(DEPLOYMENT.decimals[idx(symbol)]);
const MAX = 2n ** 255n;

function makeBook(interior = [true, true, true]): LiveBook {
  const base = initialDemoBook(DEPLOYMENT);
  return {
    ...base,
    ticks: base.ticks.map((tick, index) => ({ ...tick, isInterior: interior[index] })),
    custody: DEPLOYMENT.decimals.map((decimals) => 3_590_186n * 10n ** BigInt(decimals)),
    required: DEPLOYMENT.decimals.map((decimals) => 3_590_186n * 10n ** BigInt(decimals)),
    feeLiability: [0n, 0n, 0n, 0n],
    totalShares: [10n ** 25n, 10n ** 25n, 10n ** 25n],
    solvent: true,
  };
}

function makeAccount(overrides: Partial<AccountState> = {}): AccountState {
  return {
    balances: [0n, 0n, 0n, 0n],
    routerAllowances: [0n, 0n, 0n, 0n],
    hookAllowances: [0n, 0n, 0n, 0n],
    shares: [0n, 0n, 0n],
    pendingFees: [[0n, 0n, 0n, 0n], [0n, 0n, 0n, 0n], [0n, 0n, 0n, 0n]],
    ...overrides,
  };
}

function fakeServices(book = makeBook(), account = makeAccount()) {
  const services: LiveServices = {
    readBook: vi.fn(async () => book),
    readAccount: vi.fn(async () => account),
    readRecentSwaps: vi.fn(async () => ({
      ok: true,
      latest: 100n,
      swaps: [{ input: idx("USDC"), output: idx("DAI"), amountIn: units("USDC", 1000n), amountOut: 999_433_404_420_670_936_920n, fee: 500_000n, crossings: 0n, hash: "0x23e33f62af47efb078152ae5d8ef18b144f65771b6bc2cf87c7414c353e19e46" as const, blockNumber: 99n }],
    })),
    readSwapsBetween: vi.fn(async () => []),
    blockNumber: vi.fn(async () => 100n),
    previewLiquidity: vi.fn(async () => [1_000_000n, 1_000_000n, 10n ** 18n, 10n ** 18n]),
    send: vi.fn(async () => "0x01" as const),
    waitForReceipt: vi.fn(async () => "success" as const),
  };
  return services;
}

type Host = EventTarget & { ethereum?: unknown };
function walletHost(chainId = "0x515"): Host {
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
}

let container: HTMLDivElement;
let root: Root;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  history.replaceState({}, "", "/app");
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const byText = (text: string, selector = "button") =>
  [...document.querySelectorAll<HTMLElement>(selector)].find((node) => node.textContent?.trim() === text || node.getAttribute("aria-label") === text);
const containing = (text: string, selector = "button") =>
  [...document.querySelectorAll<HTMLElement>(selector)].find((node) => node.textContent?.includes(text));
const click = async (node: HTMLElement | undefined) => {
  expect(node).toBeTruthy();
  await act(async () => node!.click());
  await flush();
};
const type = async (label: string, value: string) => {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label='${label}']`)!;
  expect(input).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
};
const mainButton = () => document.querySelector<HTMLButtonElement>(".uni-main-button")!;
const render = async (services: ServicesProp, host: EventTarget = new EventTarget(), stats?: PoolStatsReader) => {
  await act(async () => root.render(<UniApp navigate={() => {}} sandbox={<div>SANDBOX CONTENT</div>} services={services} stats={stats} walletHost={host} />));
  await flush();
};
async function chooseToken(side: "Sell" | "Buy", symbol: string) {
  const panel = [...document.querySelectorAll<HTMLElement>(".uni-panel")].find((node) => node.querySelector(".uni-panel-label")?.textContent === side)!;
  await click(panel.querySelector<HTMLElement>(".uni-token-pill")!);
  await click(byText(symbol, ".uni-token-row .uni-token-row-symbol")?.closest("button") as HTMLElement);
}

describe("Swap page", () => {
  it("shows the Orbital-branded Uniswap-style landing swap", async () => {
    await render(fakeServices());
    expect(document.querySelector("h1")?.textContent).toBe("Swap every stablecoin, one book.");
    expect(document.querySelector(".uni-footer-note")?.textContent).toContain("one shared reserve book");
    expect(document.body.textContent).not.toMatch(/uniswap/i);
    for (const tab of ["Limit", "Buy", "Sell"]) expect((byText(tab, ".uni-tabs button") as HTMLButtonElement).disabled).toBe(true);
    expect(mainButton().textContent).toBe("Connect wallet");
    expect(containing("Select token", ".uni-token-pill")).toBeTruthy();
  });

  it("quotes exactly against the live book with $1-per-token values", async () => {
    await render(fakeServices());
    await chooseToken("Buy", "DAI");
    await type("Sell amount", "1000");
    expect((document.querySelector("input[aria-label='Buy amount']") as HTMLInputElement).value).toBe("999.4334");
    expect(document.querySelector(".uni-panel .uni-usd")?.textContent).toBe("$1,000.00");
    expect(document.querySelector(".uni-rate")?.textContent).toContain("1 USDC = 0.9994 DAI");
  });

  it("filters the token list and flips instead of selecting the same token twice", async () => {
    await render(fakeServices());
    await chooseToken("Buy", "DAI");
    const sellPanel = document.querySelector<HTMLElement>(".uni-panel")!;
    await click(sellPanel.querySelector<HTMLElement>(".uni-token-pill")!);
    await type("Search tokens", "fra");
    expect([...document.querySelectorAll(".uni-token-row")].map((row) => row.querySelector(".uni-token-row-symbol")?.textContent)).toEqual(["FRAX"]);
    await type("Search tokens", "");
    await click(byText("DAI", ".uni-token-row .uni-token-row-symbol")?.closest("button") as HTMLElement);
    const pills = [...document.querySelectorAll(".uni-token-pill")].map((pill) => pill.textContent);
    expect(pills[0]).toContain("DAI");
    expect(pills[1]).toContain("USDC");
  });

  it("flips sell and buy with the arrow button", async () => {
    await render(fakeServices());
    await chooseToken("Buy", "FRAX");
    await click(byText("Switch tokens"));
    const pills = [...document.querySelectorAll(".uni-token-pill")].map((pill) => pill.textContent);
    expect(pills[0]).toContain("FRAX");
    expect(pills[1]).toContain("USDC");
  });

  it("walks the main button through connect, token, amount and balance states", async () => {
    await render(fakeServices(), walletHost());
    await click(byText("Connect", ".uni-nav button"));
    await click(containing("Rabby", ".uni-drawer button"));
    expect(mainButton().textContent).toBe("Select a token");
    await chooseToken("Buy", "DAI");
    expect(mainButton().textContent).toBe("Enter an amount");
    await type("Sell amount", "100");
    expect(mainButton().textContent).toBe("Insufficient USDC balance");
  });

  it("offers approval then review, and the review shows the slippage-bounded minimum", async () => {
    const account = makeAccount({ balances: [MAX, MAX, MAX, MAX] });
    const services = fakeServices(makeBook(), account);
    services.send = vi.fn(async (_provider, _account, request) => {
      if (request.functionName === "approve") account.routerAllowances = [MAX, MAX, MAX, MAX];
      return "0x01" as const;
    });
    await render(services, walletHost());
    await click(byText("Connect", ".uni-nav button"));
    await click(containing("Rabby", ".uni-drawer button"));
    await chooseToken("Buy", "DAI");
    await type("Sell amount", "1000");
    expect(mainButton().textContent).toBe("Approve USDC");

    await click(mainButton());
    expect((services.send as ReturnType<typeof vi.fn>).mock.calls[0][2].functionName).toBe("approve");
    await click(byText("Settings"));
    await type("Custom slippage", "1");
    await click(byText("Settings"));
    expect(mainButton().textContent).toBe("Review");
    await click(mainButton());
    const modal = document.querySelector(".uni-modal")!;
    expect(modal.textContent).toContain("You're swapping");
    // 999.433404420670936920 DAI × 0.99, rounded down in wei, displayed to 4 decimals.
    expect(modal.textContent).toContain("989.439");
    await click(byText("Swap", ".uni-modal button"));
    expect(services.send).toHaveBeenCalledTimes(2);
    expect((services.send as ReturnType<typeof vi.fn>).mock.calls[1][2].functionName).toBe("swap");
    expect(document.querySelector(".uni-modal")?.textContent).toMatch(/Swap success|Swapped/);
  });
});

describe("Wallet drawers", () => {
  it("says so when no wallet is installed", async () => {
    await render(fakeServices());
    await click(byText("Connect", ".uni-nav button"));
    expect(document.querySelector(".uni-drawer")?.textContent).toContain("No wallets detected");
  });

  it("asks to switch networks when the wallet is on another chain", async () => {
    await render(fakeServices(), walletHost("0x1"));
    await click(byText("Connect", ".uni-nav button"));
    await click(containing("Rabby", ".uni-drawer button"));
    expect(mainButton().textContent).toBe("Switch to Unichain Sepolia");
  });

  it("mints all four test tokens from the account drawer", async () => {
    const services = fakeServices();
    await render(services, walletHost());
    await click(byText("Connect", ".uni-nav button"));
    await click(containing("Rabby", ".uni-drawer button"));
    await click(containing("0x0000", ".uni-nav button"));
    await click(containing("Mint test tokens", ".uni-drawer button"));
    const calls = (services.send as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(4);
    expect(calls.every((call) => call[2].functionName === "mint")).toBe(true);
  });
});

describe("Pool, Explore and Sandbox pages", () => {
  it("lists positions with in-range and out-of-range pills and previews a new position", async () => {
    history.replaceState({}, "", "/app/pools/unichain-sepolia");
    const services = fakeServices(makeBook([false, true, true]), makeAccount({ shares: [5n * 10n ** 21n, 0n, 0n] }));
    await render(services, walletHost());
    await click(byText("Connect", ".uni-nav button"));
    await click(containing("Rabby", ".uni-drawer button"));
    const cards = [...document.querySelectorAll(".uni-position-card")];
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).toContain("Out of range");
    await click(containing("New position"));
    await click(containing("Range 2", ".uni-range-option"));
    expect(services.previewLiquidity).toHaveBeenCalledWith("add", 1, expect.any(BigInt));
    expect(document.querySelector(".uni-deposit")?.textContent).toContain("USDC");
  });

  it("shows held reserves in dollars and links transactions to Blockscout", async () => {
    history.replaceState({}, "", "/app/explore");
    await render(fakeServices());
    expect(document.body.textContent).toContain("$14,360,744.00");
    const link = [...document.querySelectorAll<HTMLAnchorElement>(".uni-tx-table a")].find((node) => node.href.includes("0x23e33f62"));
    expect(link).toBeTruthy();
  });

  it("renders the sandbox inside the app shell and navigates between pages", async () => {
    await render(fakeServices());
    await click(byText("Sandbox", ".uni-nav a"));
    expect(location.pathname).toBe("/app/sandbox");
    expect(document.body.textContent).toContain("SANDBOX CONTENT");
    await click(byText("Explore", ".uni-nav a"));
    expect(location.pathname).toBe("/app/explore");
  });

  it("offers the Auto / Light / Dark theme control in the app's ⋯ menu", async () => {
    await render(fakeServices());
    await click(byText("More", ".uni-nav button"));
    expect([...document.querySelectorAll(".uni-menu .theme-menu button")].map((node) => node.textContent)).toEqual(["Auto", "Light", "Dark"]);
  });
});

describe("Pools across networks", () => {
  const D = 10n ** 18n;
  const stats: PoolStatsReader = async (network) => {
    if (network.key === "arbitrum-sepolia") throw new Error("rpc down");
    if (network.key === "unichain-sepolia") return { tvl: 14_360_744n * D, volume24h: 28_100n * D };
    return { tvl: 14_360_744n * D, volume24h: null };
  };

  it("lists one Orbital pool per testnet with network, address, 24h volume and TVL", async () => {
    history.replaceState({}, "", "/app/pools");
    await render(fakeServices(), new EventTarget(), stats);
    const rows = [...document.querySelectorAll<HTMLElement>(".uni-pools-row")];
    expect(rows.map((row) => row.querySelector(".uni-pools-network")?.textContent)).toEqual(["Unichain Sepolia", "Ethereum Sepolia", "Arbitrum Sepolia", "Arc Testnet"]);
    expect(rows[0].textContent).toContain("$14.36M");
    expect(rows[0].textContent).toContain("$28.1K");
    expect(rows[1].querySelector(".uni-pools-volume")?.textContent).toBe("—");
    expect(rows[2].querySelector(".uni-pools-tvl")?.textContent).toBe("—");
    for (const row of rows) expect(row.querySelectorAll(".uni-logo-stack img")).toHaveLength(4);
    await type("Search pools", "arc");
    expect(document.querySelectorAll(".uni-pools-row")).toHaveLength(1);
  });

  it("opens a pool on its own network from the list", async () => {
    history.replaceState({}, "", "/app/pools");
    const factory = vi.fn(() => fakeServices());
    await render(factory, new EventTarget(), stats);
    await click(containing("Ethereum Sepolia", ".uni-pools-row") as HTMLElement);
    expect(location.pathname).toBe("/app/pools/sepolia");
    expect(factory).toHaveBeenLastCalledWith(expect.objectContaining({ key: "sepolia" }));
    expect(document.querySelector(".uni-pool-network")?.textContent).toContain("Ethereum Sepolia");
    expect(localStorage.getItem("orbital:network")).toBe("sepolia");
  });

  it("switches the active network from the nav and reads that network's pool", async () => {
    history.replaceState({}, "", "/app/explore");
    const factory = vi.fn(() => fakeServices());
    await render(factory);
    expect(factory).toHaveBeenLastCalledWith(expect.objectContaining({ key: "unichain-sepolia" }));
    await click(document.querySelector<HTMLElement>(".uni-network-button")!);
    await click(containing("Arc Testnet", ".uni-network-menu button") as HTMLElement);
    expect(factory).toHaveBeenLastCalledWith(expect.objectContaining({ key: "arc-testnet" }));
    const links = [...document.querySelectorAll<HTMLAnchorElement>(".uni-contract-table a")].map((node) => node.href);
    expect(links.every((href) => href.startsWith("https://testnet.arcscan.app/address/"))).toBe(true);
    expect(document.querySelector(".uni-network-button")?.textContent).toContain("Arc");
  });
});
