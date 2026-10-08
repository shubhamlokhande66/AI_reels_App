"use client";

import { useState } from "react";
import type { Catalog } from "./Gallery";

export type LibTab = "media" | "audio" | "text" | "transitions" | "effects" | "looks";
export const LIB_TABS: { id: LibTab; label: string; icon: string }[] = [
  { id: "media", label: "Media", icon: "▦" },
  { id: "audio", label: "Audio", icon: "♪" },
  { id: "text", label: "Titles", icon: "T" },
  { id: "transitions", label: "Transitions", icon: "⇄" },
  { id: "effects", label: "Effects", icon: "✧" },
  { id: "looks", label: "Filters", icon: "◐" },
];

const startsWith = (...p: string[]) => (id: string) => p.some((x) => id === x || id.startsWith(`${x}_`) || id.startsWith(x));
const CATEGORIES: Record<"transitions" | "effects" | "looks", { name: string; match: (id: string) => boolean }[]> = {
  transitions: [
    { name: "Basic", match: (t) => ["cut", "fade", "dissolve", "flash", "blur", "zoom", "speed_ramp", "distance", "fade_grays"].includes(t) },
    { name: "Slide", match: startsWith("slide", "smooth", "cover", "reveal") },
    { name: "Wipe", match: startsWith("wipe") },
    { name: "Shape", match: startsWith("circle", "rect_crop", "radial", "vert", "horz", "diag") },
    { name: "Creative", match: startsWith("pixelize", "squeeze", "wind", "slice") },
  ],
  effects: [
    { name: "Camera", match: (e) => ["zoom_in", "zoom_out", "ken_burns", "pan_left", "pan_right", "pan_up", "pan_down", "roll", "zoom_pulse"].includes(e) },
    { name: "Impact", match: (e) => ["punch", "punch_out", "beat_punch", "crash_zoom", "shake", "flash", "beat_flash", "freeze"].includes(e) },
    { name: "Look", match: (e) => ["none", "black_white", "glow", "vignette", "sharpen"].includes(e) },
  ],
  looks: [
    { name: "Natural", match: (l) => ["natural", "clean", "crisp", "soft", "dreamy"].includes(l) },
    { name: "Warm", match: (l) => ["warm", "golden_hour", "retro", "vintage", "sepia", "rose"].includes(l) },
    { name: "Cinematic", match: (l) => ["cinematic", "luxury", "high_contrast", "faded_film", "cool", "emerald", "neon"].includes(l) },
    { name: "Black & white", match: (l) => ["black_white", "noir"].includes(l) },
  ],
};

/** Filmora-style library chrome: tabs across the top; for transitions, effects and filters a category list and a
 * search box. ``children`` receives the catalog filtered to what is shown. */
export function Library({ tab, onTab, catalog, children }: {
  tab: LibTab;
  onTab: (t: LibTab) => void;
  catalog?: Catalog;
  children: (filtered: Catalog | undefined) => React.ReactNode;
}) {
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const browsable = tab === "transitions" || tab === "effects" || tab === "looks";
  const cats = browsable ? CATEGORIES[tab] : [];
  const keep = (id: string, label = id) => {
    const c = cats.find((x) => x.name === cat);
    return (!c || c.match(id)) && (!q || label.toLowerCase().replace(/_/g, " ").includes(q.toLowerCase()));
  };
  const filtered: Catalog | undefined = catalog && {
    transitions: tab === "transitions" ? catalog.transitions.filter((t) => keep(t)) : catalog.transitions,
    effects: tab === "effects" ? catalog.effects.filter((e) => keep(e)) : catalog.effects,
    looks: tab === "looks" ? catalog.looks.filter((l) => keep(l.id, l.label)) : catalog.looks,
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div role="tablist" aria-label="Library" className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-border px-1">
        {LIB_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => {
              onTab(t.id);
              setCat("All");
              setQ("");
            }}
            className={`flex shrink-0 flex-col items-center gap-0.5 border-b-2 px-3 py-1.5 text-[11px] transition-colors ${
              tab === t.id ? "border-accent text-accent" : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            <span aria-hidden className="text-base leading-5">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1">
        {browsable && (
          <ul className="hidden w-28 shrink-0 space-y-0.5 overflow-y-auto border-r border-border p-1.5 text-xs sm:block">
            {["All", ...cats.map((c) => c.name)].map((name) => (
              <li key={name}>
                <button
                  type="button"
                  onClick={() => setCat(name)}
                  className={`w-full rounded-md px-2 py-1.5 text-left transition-colors ${cat === name ? "bg-accent/15 text-accent" : "text-muted hover:bg-white/5 hover:text-foreground"}`}
                >
                  {name}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="min-w-0 flex-1 overflow-y-auto p-2.5">
          {browsable && (
            <div className="mb-2.5 flex gap-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={`Search ${LIB_TABS.find((t) => t.id === tab)?.label.toLowerCase()}…`}
                className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-accent"
              />
              <select value={cat} onChange={(e) => setCat(e.target.value)} className="rounded-lg border border-border bg-background px-2 text-xs sm:hidden" aria-label="Category">
                {["All", ...cats.map((c) => c.name)].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </div>
          )}
          {children(filtered)}
        </div>
      </div>
    </div>
  );
}
