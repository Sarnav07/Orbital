import { useState } from "react";
import { readThemePreference, setThemePreference, type ThemePreference } from "./theme";

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** Uniswap-style segmented theme control used inside the ⋯ menus. */
export function ThemeMenu() {
  const [preference, setPreference] = useState<ThemePreference>(() => readThemePreference());
  return <div className="theme-menu" role="group" aria-label="Theme">
    <span>Theme</span>
    <div className="theme-segment">{OPTIONS.map((option) => <button type="button" key={option.value} aria-pressed={preference === option.value} className={preference === option.value ? "active" : ""} onClick={() => { setThemePreference(option.value); setPreference(option.value); }}>{option.label}</button>)}</div>
  </div>;
}
