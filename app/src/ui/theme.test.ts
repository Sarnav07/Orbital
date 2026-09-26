// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { applyThemePreference, readThemePreference, setThemePreference, THEME_KEY } from "./theme";

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("theme preference", () => {
  it("defaults to following the system (no data-theme attribute)", () => {
    expect(readThemePreference()).toBe("auto");
    applyThemePreference("auto");
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("applies and remembers an explicit light or dark choice", () => {
    setThemePreference("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem(THEME_KEY)).toBe("light");
    expect(readThemePreference()).toBe("light");
    setThemePreference("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    setThemePreference("auto");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(readThemePreference()).toBe("auto");
  });

  it("falls back to auto when storage is unavailable or holds junk", () => {
    localStorage.setItem(THEME_KEY, "sepia");
    expect(readThemePreference()).toBe("auto");
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(readThemePreference(broken)).toBe("auto");
    expect(() => setThemePreference("dark", broken)).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
