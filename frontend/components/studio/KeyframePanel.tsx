"use client";

import { useState } from "react";
import type { Ease, EdlSegment, Keyframe } from "@/types/api";
import { op } from "@/lib/ops";

type Edit = (ops: object[], label?: string) => void;
type Prop = "zoom" | "x" | "y" | "rotation" | "opacity" | "blur" | "brightness" | "speed";

const PROPS: { key: Prop; label: string; min: number; max: number; step: number }[] = [
  { key: "zoom", label: "Zoom", min: 1, max: 3, step: 0.01 },
  { key: "x", label: "Pan ←→", min: -1, max: 1, step: 0.05 },
  { key: "y", label: "Pan ↑↓", min: -1, max: 1, step: 0.05 },
  { key: "rotation", label: "Tilt °", min: -20, max: 20, step: 0.5 },
  { key: "opacity", label: "Opacity", min: 0, max: 1, step: 0.05 },
  { key: "blur", label: "Blur", min: 0, max: 1, step: 0.05 },
  { key: "brightness", label: "Light", min: -0.5, max: 0.5, step: 0.05 },
  { key: "speed", label: "Speed", min: 0.25, max: 4, step: 0.05 },
];
const EASES: Ease[] = ["linear", "ease_in", "ease_out", "ease_in_out", "hold"];
const LOOKS = ["glow", "black_white", "vignette", "sharpen"];
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Ready-made animations for this shot, in the renderer's own terms (backend video/keyframes.py). */
function presets(len: number, at: number): { label: string; keyframes: Keyframe[] }[] {
  const hit = Math.min(Math.max(at, 0), Math.max(len - 0.25, 0));
  return [
    { label: "Slow push-in", keyframes: [{ t: 0, zoom: 1, ease: "linear" }, { t: r3(len), zoom: 1.08, ease: "ease_in_out" }] },
    { label: "Punch at playhead", keyframes: [{ t: r3(hit), zoom: 1, ease: "hold" }, { t: r3(hit + 0.001), zoom: 1.12, ease: "hold" }, { t: r3(Math.min(hit + 0.25, len)), zoom: 1, ease: "ease_out" }] },
    { label: "Pan →", keyframes: [{ t: 0, zoom: 1.15, x: -0.8, ease: "linear" }, { t: r3(len), zoom: 1.15, x: 0.8, ease: "ease_in_out" }] },
    { label: "Pan ←", keyframes: [{ t: 0, zoom: 1.15, x: 0.8, ease: "linear" }, { t: r3(len), zoom: 1.15, x: -0.8, ease: "ease_in_out" }] },
    { label: "Zoom out", keyframes: [{ t: 0, zoom: 1.15, ease: "linear" }, { t: r3(len), zoom: 1, ease: "ease_out" }] },
    { label: "Fade out end", keyframes: [{ t: r3(Math.max(len - 0.5, 0)), opacity: 1, ease: "linear" }, { t: r3(len), opacity: 0, ease: "ease_in" }] },
    // speed ramps (backend video/keyframes.ramp_preset), timed to the shot / the playhead
    { label: "Ramp into drop", keyframes: [{ t: 0, speed: 0.6, ease: "linear" }, { t: r3(len * 0.6), speed: 0.6, ease: "linear" }, { t: r3(len), speed: 2, ease: "ease_in" }] },
    { label: "Slow-mo at playhead", keyframes: [{ t: 0, speed: 1, ease: "linear" }, { t: r3(Math.max(hit - 0.15, 0)), speed: 1, ease: "linear" }, { t: r3(hit), speed: 0.35, ease: "ease_out" }, { t: r3(Math.min(hit + 0.6, len)), speed: 1, ease: "ease_in_out" }] },
    { label: "Fast off drop", keyframes: [{ t: 0, speed: 2, ease: "linear" }, { t: r3(Math.min(0.5, len)), speed: 1, ease: "ease_out" }] },
  ];
}

/** The shot's keyframe animation: ready-made moves, every keyframe editable, and colour looks that stack on top. */
export function KeyframePanel({ seg, playhead, busy, onEdit }: { seg: EdlSegment; playhead?: number; busy: boolean; onEdit: Edit }) {
  const len = seg.timelineEnd - seg.timelineStart;
  const local = playhead !== undefined ? r3(Math.min(Math.max(playhead - seg.timelineStart, 0), len)) : 0;
  // a fresh draft whenever the shot or its saved keyframes change (the parent keys this panel on them)
  const [draft, setDraft] = useState<Keyframe[]>(seg.keyframes ?? []);
  const save = (kfs: Keyframe[], label: string) => onEdit([op.keyframes(seg.id, kfs)], label);
  const set = (i: number, patch: Partial<Keyframe>) => setDraft((d) => d.map((k, j) => (j === i ? { ...k, ...patch } : k)));
  const looks = seg.looks ?? [];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {presets(len, local).map((p) => (
          <button key={p.label} type="button" disabled={busy} onClick={() => save([...draft.filter((k) => !p.keyframes.some((n) => Math.abs(n.t - k.t) < 0.002)), ...p.keyframes], p.label)}
            className="rounded-lg border border-border px-2 py-1 text-[11px] hover:border-accent/50 disabled:opacity-40">
            {p.label}
          </button>
        ))}
      </div>
      {draft.length > 0 && (
        <div className="max-h-56 space-y-1.5 overflow-y-auto">
          {draft.map((k, i) => (
            <div key={i} className="rounded-lg border border-border p-1.5 text-[11px]">
              <div className="mb-1 flex items-center gap-1.5">
                <span className="text-muted">at</span>
                <input type="number" className="w-16 rounded border border-border bg-surface px-1" min={0} max={r3(len)} step={0.01} value={k.t}
                  onChange={(e) => set(i, { t: Number(e.target.value) })} />
                <span className="text-muted">s</span>
                <select className="rounded border border-border bg-surface px-1" value={k.ease} onChange={(e) => set(i, { ease: e.target.value as Ease })}>
                  {EASES.map((e) => <option key={e} value={e}>{e.replace(/_/g, " ")}</option>)}
                </select>
                <button type="button" className="ml-auto text-muted hover:text-danger" disabled={busy} onClick={() => save(draft.filter((_, j) => j !== i), "Delete keyframe")}>✕</button>
              </div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                {PROPS.map((p) => (
                  <label key={p.key} className="flex items-center gap-1">
                    <span className="w-14 shrink-0 text-muted">{p.label}</span>
                    <input type="number" className="w-full rounded border border-border bg-surface px-1" min={p.min} max={p.max} step={p.step}
                      value={k[p.key] ?? ""} placeholder="—"
                      onChange={(e) => set(i, { [p.key]: e.target.value === "" ? null : Number(e.target.value) })} />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="text-xs text-accent hover:underline" disabled={busy}
          onClick={() => save([...draft, { t: local, zoom: 1, ease: "linear" }], "Add keyframe")}>+ Keyframe at playhead ({local.toFixed(2)} s)</button>
        {JSON.stringify(draft) !== JSON.stringify(seg.keyframes ?? []) && (
          <button type="button" className="text-xs text-accent hover:underline" disabled={busy} onClick={() => save(draft, "Edit keyframes")}>Apply changes</button>
        )}
        {draft.length > 0 && (
          <button type="button" className="text-xs text-muted hover:text-danger" disabled={busy} onClick={() => save([], "Clear keyframes")}>Clear</button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <span className="text-[11px] text-muted">Looks on top:</span>
        {LOOKS.map((l) => {
          const on = looks.includes(l);
          return (
            <button key={l} type="button" disabled={busy} onClick={() => onEdit([op.looks(seg.id, on ? looks.filter((x) => x !== l) : [...looks, l])], `${on ? "Remove" : "Add"} ${l}`)}
              className={`rounded-full border px-2 py-0.5 text-[11px] ${on ? "border-accent bg-accent/15 text-accent" : "border-border text-muted hover:text-foreground"}`}>
              {l.replace("_", " ")}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted">Keyframes move the picture instead of the effect&apos;s own movement; the effect&apos;s flash and the looks stay.</p>
    </div>
  );
}
