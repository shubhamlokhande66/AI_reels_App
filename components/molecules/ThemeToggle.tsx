"use client";

import { Icon } from "@/components/atoms";
import { type ThemePref } from "@/lib/theme";
import { useTheme } from "@/lib/useTheme";

/** The quick switch in the menu and the sidebar: Light <-> Dark (it remembers the choice on this device). */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, setPref } = useTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      onClick={() => setPref(dark ? "light" : "dark")}
      className={`row min-h-[44px] w-full justify-between gap-2 rounded-xl px-1 text-left sm ${className}`}
      title={dark ? "Switch to the light look" : "Switch to the dark look"}
    >
      <span className="row gap-2">
        <Icon name={dark ? "moon" : "sun"} size={18} />
        {dark ? "Dark look" : "Light look"}
      </span>
      <span aria-hidden className={`relative h-6 w-11 shrink-0 rounded-full border border-border transition-colors ${dark ? "bg-accent" : "bg-surface-2"}`}>
        <span className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-[var(--surface)] shadow transition-[left] ${dark ? "left-[22px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

const CHOICES: [ThemePref, string, string][] = [
  ["light", "Light", "sun"],
  ["dark", "Dark", "moon"],
  ["system", "Same as my phone", "gear"],
];
/** The full choice (My account): Light, Dark, or the same as the phone / computer. */
export function ThemeChoice() {
  const { pref, setPref } = useTheme();
  return (
    <section className="card" aria-label="Appearance">
      <span className="h2">Appearance</span>
      <span className="mu sm">How Shubix looks on this device. Every page follows it.</span>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Look">
        {CHOICES.map(([v, label, icon]) => (
          <button key={v} type="button" role="radio" aria-checked={pref === v} className={`chip ${pref === v ? "on" : ""}`} onClick={() => setPref(v)}>
            <Icon name={icon} size={14} />
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}
