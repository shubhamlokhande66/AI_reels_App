"use client";

import { Card, Chip, Heading, Icon } from "@/components/atoms";
import { cn } from "@/lib/cn";
import { useText } from "@/hooks/useApi";
import { type ThemePref } from "@/lib/theme";
import { useTheme } from "@/lib/useTheme";

/** The quick switch in the menu and the sidebar: Light <-> Dark (it remembers the choice on this device). */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, setPref } = useTheme();
  const text = useText();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      onClick={() => setPref(dark ? "light" : "dark")}
      className={cn("flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl px-1 text-left text-[12.5px]", className)}
      title={text(dark ? "look.toLight" : "look.toDark")}
    >
      <span className="flex items-center gap-2">
        <Icon name={dark ? "moon" : "sun"} size={18} />
        {text(dark ? "look.dark" : "look.light")}
      </span>
      <span aria-hidden className={`relative h-6 w-11 shrink-0 rounded-full border border-border transition-colors ${dark ? "bg-accent" : "bg-surface-2"}`}>
        <span className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-[var(--surface)] shadow transition-[left] ${dark ? "left-[22px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

const CHOICES: [ThemePref, string, string][] = [
  ["light", "look.choiceLight", "sun"],
  ["dark", "look.choiceDark", "moon"],
  ["system", "look.choiceSystem", "gear"],
];
/** The full choice (My account): Light, Dark, or the same as the phone / computer. */
export function ThemeChoice() {
  const { pref, setPref } = useTheme();
  const text = useText();
  return (
    <Card as="section" aria-label={text("look.title")} className="flex flex-col gap-2.5">
      <Heading size="section">{text("look.title")}</Heading>
      <p className="m-0 text-[12.5px] text-muted">{text("look.text")}</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={text("look.title")}>
        {CHOICES.map(([v, key, icon]) => (
          <Chip key={v} role="radio" aria-checked={pref === v} on={pref === v} onClick={() => setPref(v)}>
            <Icon name={icon} size={14} />
            {text(key)}
          </Chip>
        ))}
      </div>
    </Card>
  );
}
