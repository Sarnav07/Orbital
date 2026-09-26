export type ThemePreference = "auto" | "light" | "dark";
export const THEME_KEY = "orbital:theme";
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const defaultStore = (): Store | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/** The saved choice, or "auto" (follow the system) when nothing valid is stored. */
export function readThemePreference(store: Store | null = defaultStore()): ThemePreference {
  try {
    const value = store?.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "auto";
  } catch {
    return "auto";
  }
}

/** Auto removes the attribute so CSS falls back to prefers-color-scheme. */
export function applyThemePreference(preference: ThemePreference) {
  if (preference === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = preference;
}

export function setThemePreference(preference: ThemePreference, store: Store | null = defaultStore()) {
  applyThemePreference(preference);
  try {
    if (preference === "auto") store?.removeItem(THEME_KEY);
    else store?.setItem(THEME_KEY, preference);
  } catch {
    // Storage blocked: the choice still applies for this page view.
  }
}
