// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App, heroTitle, problemCards, shouldShowPreloader } from "./App";

class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}

let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("IntersectionObserver", NoopObserver);
  vi.stubGlobal("ResizeObserver", NoopObserver);
  window.matchMedia = window.matchMedia ?? ((query: string) => ({
    matches: query.includes("reduce"), media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  }) as MediaQueryList);
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  // The live testnet tab must never reach the network from unit tests.
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline in tests"); }));
});

beforeEach(() => {
  history.replaceState({}, "", "/");
  sessionStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = () => act(() => root.render(<App />));
const link = (text: string) => [...container.querySelectorAll("a")].find((anchor) => anchor.textContent?.includes(text))!;

describe("Orbital landing experience", () => {
  it("shows the preloader once per browser session", () => {
    const storage = new Map<string, string>();
    const session = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => void storage.set(key, value) };
    expect(shouldShowPreloader(session)).toBe(true);
    expect(shouldShowPreloader(session)).toBe(false);
    expect(shouldShowPreloader({ getItem: () => { throw new Error("blocked"); }, setItem: () => {} })).toBe(false);
  });

  it("pitches an n-asset book while stating the live 4-coin deployment", () => {
    render();
    const headline = container.querySelector("h1")?.textContent ?? "";
    expect(headline).toBe(heroTitle);
    expect(headline).toContain("n stablecoins");
    expect(headline).not.toMatch(/four/i);
    const text = container.textContent ?? "";
    expect(text).toMatch(/4-coin/i);
    expect(text).toMatch(/Unichain Sepolia/);
    expect(text).not.toMatch(/every stablecoin/i);
  });

  it("describes Curve's StableSwap curve instead of constant product", () => {
    const flat = problemCards.find((card) => card[2] === "Flat")!;
    expect(flat[3]).not.toMatch(/x\s*·\s*y\s*=\s*k/);
    expect(flat[1]).not.toMatch(/1–2×/);
  });

  it("keeps each problem card to one short line and links its detail to the docs", () => {
    render();
    const cards = [...container.querySelectorAll(".problem-card")];
    expect(cards).toHaveLength(3);
    for (const card of cards) expect(card.querySelectorAll("p")).toHaveLength(1);
    const links = cards.map((card) => card.querySelector<HTMLAnchorElement>("a.card-more")!);
    expect(links.map((node) => node.getAttribute("href"))).toEqual(["/docs#shared-book", "/docs#liquidity", "/docs#depegs"]);
    act(() => links[2].click());
    expect(location.pathname).toBe("/docs");
  });

  it("lays the protocol out as six even cards and the architecture as three, each with one line and a docs link", () => {
    render();
    const cards = [...container.querySelectorAll(".principle-card")];
    expect(cards).toHaveLength(6);
    expect(container.querySelectorAll(".principle-card.wide")).toHaveLength(0);
    for (const card of cards) expect(card.querySelectorAll("p:not(.card-number)")).toHaveLength(1);
    expect(cards.map((card) => card.querySelector("a.card-more")?.getAttribute("href"))).toEqual(["/docs#shared-book", "/docs#curve", "/docs#liquidity", "/docs#depegs", "/docs#custody", "/docs#execution"]);
    const steps = [...container.querySelectorAll(".architecture-card")];
    expect(steps.map((card) => card.querySelector("a.card-more")?.getAttribute("href"))).toEqual(["/docs#shared-book", "/docs#execution", "/docs#swaps"]);
    act(() => (steps[2].querySelector("a.card-more") as HTMLAnchorElement).click());
    expect(location.pathname).toBe("/docs");
  });

  it("gives every landing section a unique index", () => {
    render();
    const indices = [...container.querySelectorAll(".section-index")].map((node) => node.textContent?.split("·")[0].trim());
    expect(new Set(indices).size).toBe(indices.length);
  });

  it("routes the hero story link client-side instead of reloading the page", () => {
    render();
    act(() => link("Read the story").click());
    expect(location.pathname).toBe("/docs");
  });

  it("routes the sandbox teaser client-side instead of reloading the page", () => {
    render();
    act(() => link("Open sandbox").click());
    expect(location.pathname).toBe("/app/sandbox");
  });

  it("routes the gateway documentation link client-side", () => {
    render();
    act(() => link("Read documentation").click());
    expect(location.pathname).toBe("/docs");
  });

  const waitFor = async (text: string) => {
    for (let attempt = 0; attempt < 40 && !container.textContent?.includes(text); attempt += 1) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
    }
  };

  it("opens /app on the Uniswap-style swap and reaches the sandbox from the app nav", async () => {
    history.replaceState({}, "", "/app");
    // /app is code-split: warm the module cache so the lazy boundary resolves quickly.
    await import("./uni/UniApp");
    render();
    await waitFor("Swap every stablecoin, one book.");
    expect(container.querySelector("h1")?.textContent).toBe("Swap every stablecoin, one book.");
    const sandboxLink = [...container.querySelectorAll<HTMLAnchorElement>(".uni-nav a")].find((node) => node.textContent === "Sandbox")!;
    await import("./uni/SandboxPage");
    act(() => sandboxLink.click());
    expect(location.pathname).toBe("/app/sandbox");
    await waitFor("See the reserve book");
    expect(container.textContent).toContain("See the reserve book");
  });

  it("shows the depeg stress model in the sandbox with each range's trap price", async () => {
    history.replaceState({}, "", "/app/sandbox");
    await import("./uni/UniApp");
    render();
    await waitFor("Depeg stress");
    const text = container.textContent ?? "";
    expect(text).toContain("Depeg stress");
    expect(text).toMatch(/\$0\.90/);
    expect(text).toMatch(/\$0\.80/);
    expect(text).toMatch(/every range/i);
  });

  it("draws the sandbox like PoolSim: depeg rings, M-scaled axes and a range table with capital efficiency", async () => {
    history.replaceState({}, "", "/app/sandbox");
    await import("./uni/UniApp");
    await import("./uni/SandboxPage");
    render();
    await waitFor("Depeg stress");
    const ringLabels = [...container.querySelectorAll(".sb-plane .sb-ring-label")].map((node) => node.textContent);
    expect(ringLabels).toEqual(["10% · 13.1×", "20% · 6.6×", "64% · 2.0×"]);
    const axisLabels = [...container.querySelectorAll(".sb-curve .sb-axis-value")].map((node) => node.textContent ?? "");
    expect(axisLabels.length).toBeGreaterThan(4);
    for (const label of axisLabels) expect(label).toMatch(/^\d+(\.\d)?M$/);
    const head = container.querySelector(".sb-ranges-head")?.textContent ?? "";
    expect(head).toContain("Cap. eff.");
    expect([...container.querySelectorAll(".sb-range-row")].length).toBe(3);

    const commit = container.querySelector<HTMLButtonElement>(".sb-commit")!;
    expect(commit.disabled).toBe(true);
    const amount = container.querySelector<HTMLInputElement>("input[aria-label='Exact input amount']")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(amount, "250000");
      amount.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(commit.disabled).toBe(false);
    act(() => commit.click());
    expect(container.querySelectorAll(".sb-history li").length).toBe(1);
    expect(container.querySelector(".sb-replay button:last-of-type")?.textContent).toBe("Reset");
  });

  it("renders the docs guide: every sidebar link has a section, and the pool diagram follows the chosen direction", () => {
    history.replaceState({}, "", "/docs");
    render();
    const guide = container.querySelector(".dg")!;
    expect(guide).toBeTruthy();
    const anchors = [...guide.querySelectorAll(".dg-sidebar nav a")].map((node) => node.getAttribute("href")!.slice(1));
    expect(anchors.length).toBe(13);
    for (const id of anchors) expect(container.querySelector(`#${id}`)).toBeTruthy();

    const select = container.querySelector<HTMLSelectElement>("#dg-direction")!;
    act(() => {
      select.value = String([...select.options].findIndex((option) => option.textContent === "DAI → FRAX"));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.querySelector(".dg-pool-figure figcaption")?.textContent).toContain("DAI goes in. FRAX comes out.");
    expect(container.querySelector("#contracts")?.textContent).toContain("0x10f107C223E83C0c3D43f3afe0eD75e0a06B2888");
    expect(container.textContent).toMatch(/traps near \$0\.90/);
    expect(container.querySelector(".dg-lead")?.textContent).toMatch(/\bn stablecoins/);
  });

  it("uses a Uniswap-style landing bar with Launch app, a theme menu and hero orbs", () => {
    render();
    const bar = container.querySelector(".site-nav")!;
    expect(bar).toBeTruthy();
    expect([...bar.querySelectorAll("a")].map((node) => node.textContent?.trim())).toEqual(expect.arrayContaining(["Protocol", "Simulator", "Docs", "Paper ↗", "Launch app"]));
    act(() => (bar.querySelector("button[aria-label='More']") as HTMLButtonElement).click());
    const light = [...bar.querySelectorAll<HTMLButtonElement>(".theme-menu button")].find((node) => node.textContent === "Light")!;
    act(() => light.click());
    expect(document.documentElement.dataset.theme).toBe("light");
    const auto = [...bar.querySelectorAll<HTMLButtonElement>(".theme-menu button")].find((node) => node.textContent === "Auto")!;
    act(() => auto.click());
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(container.querySelector(".hero .uni-orbs")).toBeTruthy();
  });

  it("keeps the landing bar transparent at the top and solid once scrolled", () => {
    render();
    const bar = container.querySelector(".site-nav")!;
    expect(bar.classList.contains("is-scrolled")).toBe(false);
    act(() => { Object.defineProperty(window, "scrollY", { value: 100, configurable: true }); dispatchEvent(new Event("scroll")); });
    expect(bar.classList.contains("is-scrolled")).toBe(true);
    act(() => { Object.defineProperty(window, "scrollY", { value: 0, configurable: true }); dispatchEvent(new Event("scroll")); });
    expect(bar.classList.contains("is-scrolled")).toBe(false);
  });

  it("shows floating orbs behind the docs intro", () => {
    history.replaceState({}, "", "/docs");
    render();
    expect(container.querySelector(".dg-intro-wrap .uni-orbs, .dg .uni-orbs")).toBeTruthy();
  });
});
