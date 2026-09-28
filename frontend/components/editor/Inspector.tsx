"use client";

import { useState } from "react";
import { EFFECTS, SPEEDS, TRANSITIONS, op } from "@/lib/ops";
import type { EdlSegment, Framing, Media } from "@/types/api";
import { btnSecondary } from "../ui";

interface Props {
  segment: EdlSegment;
  index: number;
  clips: Media[];
  busy: boolean;
  onEdit: (ops: object[], label?: string) => void;
}

const FIELD = "rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent disabled:opacity-50";
const LABEL = "mb-1 block text-xs text-muted";
const pretty = (s: string) => s.replaceAll("_", " ");

/** Edit the selected shot. Every change is one validated, undoable operation on the server. */
export function Inspector({ segment: s, index, clips, busy, onEdit }: Props) {
  const [start, setStart] = useState(String(s.sourceStart));
  const [end, setEnd] = useState(String(s.sourceEnd));
  const [tdur, setTdur] = useState(String(s.transitionIn.duration || 0.3));
  // The parent re-mounts this component (via `key`) whenever the server-side values change,
  // so these drafts always start from the saved state.

  const length = s.timelineEnd - s.timelineStart;
  const applyTrim = () => {
    const a = Number(start);
    const b = Number(end);
    if (Number.isFinite(a) && Number.isFinite(b)) onEdit([op.trim(s.id, a, b)], "Trim shot");
  };

  return (
    <section aria-label="Shot settings" className="space-y-4 rounded-2xl border border-border bg-surface p-4">
      <div>
        <h3 className="font-medium">
          Shot {index + 1}
          <span className="ml-2 text-sm font-normal text-muted">
            {s.video} · {length.toFixed(2)}s
          </span>
        </h3>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className={LABEL}>Speed</span>
          <select className={`${FIELD} w-full`} disabled={busy} value={s.speed} onChange={(e) => onEdit([op.speed(s.id, Number(e.target.value))])}>
            {[...new Set([...SPEEDS, s.speed])].sort((a, b) => a - b).map((v) => (
              <option key={v} value={v}>
                {v}x{v < 1 ? " (slow motion)" : ""}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className={LABEL}>Effect</span>
          <select className={`${FIELD} w-full`} disabled={busy} value={s.effect} onChange={(e) => onEdit([op.effect(s.id, e.target.value)])}>
            {EFFECTS.map((v) => (
              <option key={v} value={v}>
                {pretty(v)}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className={LABEL}>Transition in</span>
          <select
            className={`${FIELD} w-full`}
            disabled={busy || index === 0}
            value={s.transitionIn.type}
            onChange={(e) => onEdit([op.transition(s.id, e.target.value, Number(tdur) || undefined)])}
          >
            {TRANSITIONS.map((v) => (
              <option key={v} value={v}>
                {pretty(v)}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className={LABEL}>Transition length (s)</span>
          <input
            className={`${FIELD} w-full`}
            type="number"
            min={0.1}
            max={1.5}
            step={0.05}
            disabled={busy || index === 0 || s.transitionIn.type === "cut"}
            value={tdur}
            onChange={(e) => setTdur(e.target.value)}
            onBlur={() => Number(tdur) > 0 && onEdit([op.transition(s.id, s.transitionIn.type, Number(tdur))])}
          />
        </label>

        <label>
          <span className={LABEL}>Framing</span>
          <select className={`${FIELD} w-full`} disabled={busy} value={s.crop.framing} onChange={(e) => onEdit([op.framing(s.id, e.target.value as Framing)])}>
            <option value="auto">Auto</option>
            <option value="fill">Fill (crop to fit)</option>
            <option value="fit">Fit (whole picture, blurred backdrop)</option>
          </select>
        </label>

        <label>
          <span className={LABEL}>Replace with another clip</span>
          <select
            className={`${FIELD} w-full`}
            disabled={busy}
            value={s.clipId}
            onChange={(e) => onEdit([op.replace(s.id, e.target.value)], "Replace clip")}
          >
            {clips.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name.length > 40 ? `${c.name.slice(0, 38)}…` : c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="space-y-2">
        <legend className={LABEL}>Trim (position in the source clip, seconds)</legend>
        <div className="flex flex-wrap items-end gap-2">
          <label>
            <span className="sr-only">Source start</span>
            <input aria-label="Source start" className={`${FIELD} w-24`} type="number" step={0.1} min={0} value={start} disabled={busy} onChange={(e) => setStart(e.target.value)} />
          </label>
          <span className="pb-2 text-muted">→</span>
          <label>
            <span className="sr-only">Source end</span>
            <input aria-label="Source end" className={`${FIELD} w-24`} type="number" step={0.1} min={0} value={end} disabled={busy} onChange={(e) => setEnd(e.target.value)} />
          </label>
          <button type="button" className={btnSecondary} disabled={busy} onClick={applyTrim}>
            Apply trim
          </button>
        </div>
      </fieldset>
    </section>
  );
}
