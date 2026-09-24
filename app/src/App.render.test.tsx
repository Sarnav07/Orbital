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

  it("states the prototype's real scope in the headline", () => {
    render();
    expect(container.querySelector("h1")?.textContent).toBe(heroTitle);
    expect(heroTitle).not.toMatch(/every stablecoin/i);
  });

  it("describes Curve's StableSwap curve instead of constant product", () => {
    const flat = problemCards.find((card) => card[2] === "Flat")!;
    expect(flat[3]).not.toMatch(/x\s*·\s*y\s*=\s*k/);
    expect(flat[1]).not.toMatch(/1–2×/);
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
    expect(location.pathname).toBe("/app");
  });

  it("routes the gateway documentation link client-side", () => {
    render();
    act(() => link("Read documentation").click());
    expect(location.pathname).toBe("/docs");
  });
});
