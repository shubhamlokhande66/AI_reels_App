"use client";

import { useState } from "react";
import { STYLE_LABELS } from "@/lib/format";
import type { Sequence } from "@/types/api";

const DESCRIPTIONS: Record<string, string> = {
  fast_trending: "Fast beat-synced cuts, punchy zooms, quick flashes.",
  cinematic: "Longer shots, slow fades, subtle zoom, slow motion.",
  luxury: "Smooth transitions, elegant zoom, premium pacing.",
  food: "Fast action cuts, ending on a slow hero reveal.",
  travel: "Establishing shot first, landscape framing, motion transitions.",
  custom: "Balanced defaults. TODO: fine-tuning controls are not in the UI yet.",
  auto: "Picks a style from your music and footage (with AI assist on, the AI decides).",
};

export function StyleSelector({
  value,
  onChange,
  disabled,
  ids = Object.keys(STYLE_LABELS),
}: {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  ids?: string[];
}) {
  return (
    <div role="radiogroup" aria-label="Video style" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {ids.map((id) => {
        const selected = value === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(id)}
            className={`rounded-2xl border p-3 text-left transition-colors disabled:opacity-50 ${
              selected ? "border-accent bg-accent/10" : "border-border bg-surface hover:border-accent/50"
            }`}
          >
            <span className="block text-sm font-medium">{STYLE_LABELS[id] ?? id}</span>
            <span className="mt-0.5 block text-xs text-muted">{DESCRIPTIONS[id] ?? ""}</span>
          </button>
        );
      })}
    </div>
  );
}

export const PACES = [
  { id: "calm", label: "Calm", hint: "Long shots" },
  { id: "balanced", label: "Balanced", hint: "Recommended" },
  { id: "fast", label: "Fast", hint: "Every beat" },
] as const;

export type PaceId = (typeof PACES)[number]["id"];
/** The create form also offers "AI decides": the AI director picks the pace from the instructions and the music. */
export type PaceChoice = PaceId | "auto";
const AUTO_PACE = { id: "auto", label: "AI decides", hint: "From your instructions and the music" } as const;

export function PaceSelector<T extends PaceChoice>({ value, onChange, disabled, withAuto = false }: { value: T; onChange: (p: T) => void; disabled?: boolean; withAuto?: boolean }) {
  const options = withAuto ? [AUTO_PACE, ...PACES] : PACES;
  return (
    <div role="radiogroup" aria-label="Editing pace" className="inline-flex rounded-xl border border-border bg-surface p-1">
      {options.map((p) => (
        <button
          key={p.id}
          type="button"
          role="radio"
          aria-checked={value === p.id}
          disabled={disabled}
          onClick={() => onChange(p.id as T)}
          title={p.hint}
          className={`rounded-lg px-4 py-1.5 text-sm transition-colors disabled:opacity-50 ${
            value === p.id ? "bg-accent text-white" : "text-muted hover:text-foreground"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

export const SEQUENCES: { id: Sequence; label: string; hint: string }[] = [
  { id: "mixed", label: "Best moments", hint: "The editor picks the strongest moments and mixes them. Good for travel, events and product clips." },
  { id: "steps", label: "Step by step", hint: "Every clip once, in the order it happened, with long steps sped up and the last clip as the finale. Made for recipes, crafts and tutorials." },
];

export function SequenceSelector({ value, onChange, disabled }: { value: Sequence; onChange: (s: Sequence) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Clip order" className="grid gap-3 sm:grid-cols-2">
      {SEQUENCES.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          disabled={disabled}
          onClick={() => onChange(o.id)}
          className={`rounded-xl border p-3 text-left transition-colors disabled:opacity-50 ${value === o.id ? "border-accent bg-accent/10" : "border-border bg-surface hover:border-accent/50"}`}
        >
          <span className="block text-sm font-medium">{o.label}</span>
          <span className="mt-1 block text-xs text-muted">{o.hint}</span>
        </button>
      ))}
    </div>
  );
}

export const ORDER_MODES: { id: "auto" | "manual"; label: string; hint: string }[] = [
  { id: "auto", label: "Automatic", hint: "Guess the order from file names (WhatsApp/phone timestamps) or, with AI assist on, what each clip shows." },
  { id: "manual", label: "My order", hint: "Use the order you arrange below, exactly. The camera, zoom and quality checks are still done by the app." },
];

export function OrderModeSelector({ value, onChange, disabled }: { value: "auto" | "manual"; onChange: (v: "auto" | "manual") => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Clip order source" className="grid gap-3 sm:grid-cols-2">
      {ORDER_MODES.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          disabled={disabled}
          onClick={() => onChange(o.id)}
          className={`rounded-xl border p-3 text-left transition-colors disabled:opacity-50 ${value === o.id ? "border-accent bg-accent/10" : "border-border bg-surface hover:border-accent/50"}`}
        >
          <span className="block text-sm font-medium">{o.label}</span>
          <span className="mt-1 block text-xs text-muted">{o.hint}</span>
        </button>
      ))}
    </div>
  );
}

export function StepOptions({ teaser, stepLabels, onTeaser, onStepLabels, disabled }: { teaser: boolean; stepLabels: boolean; onTeaser: (v: boolean) => void; onStepLabels: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="space-y-2 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={teaser} disabled={disabled} onChange={(e) => onTeaser(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
        Start with a quick look at the finished dish (the last clip)
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={stepLabels} disabled={disabled} onChange={(e) => onStepLabels(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
        Show “Step 1”, “Step 2”… on screen
      </label>
    </div>
  );
}

export const DURATIONS = [15, 30, 60] as const;
export const MIN_SECONDS = 5;
export const MAX_SECONDS = 600; // 10 minutes; must match the backend limit
const QUICK = [90, 120, 180, 300] as const;

const clampSeconds = (s: number) => Math.min(Math.max(Math.round(s) || MIN_SECONDS, MIN_SECONDS), MAX_SECONDS);

export function formatLength(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m === 0 ? `${s}s` : s === 0 ? `${m} min` : `${m} min ${s}s`;
}

export function DurationSelector({ value, onChange, disabled }: { value: number; onChange: (d: number) => void; disabled?: boolean }) {
  const [customOpen, setCustomOpen] = useState(false);
  const isPreset = (DURATIONS as readonly number[]).includes(value);
  const custom = customOpen || !isPreset;
  const pill = (active: boolean) =>
    `rounded-lg px-4 py-1.5 text-sm transition-colors disabled:opacity-50 ${active ? "bg-accent text-white" : "text-muted hover:text-foreground"}`;
  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Duration" className="inline-flex flex-wrap rounded-xl border border-border bg-surface p-1">
        {DURATIONS.map((d) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={value === d && !custom}
            disabled={disabled}
            onClick={() => {
              setCustomOpen(false);
              onChange(d);
            }}
            className={pill(value === d && !custom)}
          >
            {d}s
          </button>
        ))}
        <button type="button" role="radio" aria-checked={custom} disabled={disabled} onClick={() => setCustomOpen(true)} className={pill(custom)}>
          {custom && !isPreset ? formatLength(value) : "Custom"}
        </button>
      </div>
      {custom && (
        <div className="space-y-2 rounded-xl border border-border bg-surface p-3" aria-label="Custom length">
          <CustomLength key={value} value={value} onChange={onChange} disabled={disabled} />
          <div className="flex flex-wrap gap-2">
            {QUICK.map((q) => (
              <button
                key={q}
                type="button"
                disabled={disabled}
                onClick={() => onChange(q)}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${value === q ? "border-accent bg-accent/15" : "border-border text-muted hover:text-foreground"}`}
              >
                {formatLength(q)}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted">
            Anything from {MIN_SECONDS} seconds to {MAX_SECONDS / 60} minutes. Longer Reels take longer to render, and need enough footage and a long enough
            song. Otherwise moments repeat or the Reel is shortened, and you are told.
          </p>
        </div>
      )}
    </div>
  );
}

/** Minutes + seconds. Typed values are committed on blur / Enter so half-typed numbers never jump around. */
function CustomLength({ value, onChange, disabled }: { value: number; onChange: (d: number) => void; disabled?: boolean }) {
  const [min, setMin] = useState(String(Math.floor(value / 60)));
  const [sec, setSec] = useState(String(value % 60));
  const commit = () => onChange(clampSeconds((Number(min) || 0) * 60 + (Number(sec) || 0)));
  const key = (e: React.KeyboardEvent) => e.key === "Enter" && (e.preventDefault(), commit());
  const box = "w-20 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent disabled:opacity-50";
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-xs text-muted">
        Minutes
        <input aria-label="Minutes" type="number" min={0} max={10} inputMode="numeric" className={`${box} mt-1 block`} value={min} disabled={disabled} onChange={(e) => setMin(e.target.value)} onBlur={commit} onKeyDown={key} />
      </label>
      <label className="text-xs text-muted">
        Seconds
        <input aria-label="Seconds" type="number" min={0} max={59} inputMode="numeric" className={`${box} mt-1 block`} value={sec} disabled={disabled} onChange={(e) => setSec(e.target.value)} onBlur={commit} onKeyDown={key} />
      </label>
      <span className="pb-2 text-sm text-muted">= {formatLength(value)}</span>
    </div>
  );
}
