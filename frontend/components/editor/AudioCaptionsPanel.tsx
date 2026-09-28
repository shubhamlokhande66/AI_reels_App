"use client";

import { useState } from "react";
import { op } from "@/lib/ops";
import type { EdlCaption, EdlTimeline } from "@/types/api";
import { btnDanger, btnSecondary } from "../ui";

interface Props {
  timeline: EdlTimeline;
  playhead: number;
  busy: boolean;
  onEdit: (ops: object[], label?: string) => void;
}

const FIELD = "rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent disabled:opacity-50";
const CAPTION_STYLES = ["minimal", "bold", "karaoke", "highlight", "luxury"];

function VolumeSlider({ saved, busy, onEdit }: { saved: number; busy: boolean; onEdit: Props["onEdit"] }) {
  const [volume, setVolume] = useState(saved); // remounted (keyed) when the saved value changes
  const commit = () => volume !== saved && onEdit([op.music({ volume })], "Music volume");
  return (
      <label className="block">
        <span className="mb-1 block text-xs text-muted">Volume · {Math.round(volume * 100)}%</span>
        <input
          type="range"
          aria-label="Music volume"
          min={0}
          max={1.5}
          step={0.05}
          value={volume}
          disabled={busy}
          className="w-full accent-[var(--accent)]"
          onChange={(e) => setVolume(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
        />
      </label>
  );
}

export function MusicControls({ timeline, busy, onEdit }: Omit<Props, "playhead">) {
  return (
    <section aria-label="Music" className="space-y-3 rounded-2xl border border-border bg-surface p-4">
      <h3 className="font-medium">Music</h3>
      <VolumeSlider key={timeline.musicVolume} saved={timeline.musicVolume} busy={busy} onEdit={onEdit} />
      <label className="block">
        <span className="mb-1 block text-xs text-muted">Fade-out (seconds)</span>
        <input
          type="number"
          aria-label="Fade-out"
          className={`${FIELD} w-24`}
          min={0}
          max={10}
          step={0.5}
          disabled={busy}
          defaultValue={timeline.musicFadeOut ?? ""}
          placeholder="auto"
          onBlur={(e) => e.target.value !== "" && onEdit([op.music({ fadeOut: Number(e.target.value) })], "Music fade-out")}
        />
      </label>
    </section>
  );
}

function CaptionRow({ c, busy, onEdit }: { c: EdlCaption; busy: boolean; onEdit: Props["onEdit"] }) {
  const [text, setText] = useState(c.text); // the list keys rows by content, so this resets after a save
  const num = (key: "start" | "end") => (
    <input
      aria-label={`Caption ${key}`}
      className={`${FIELD} w-20`}
      type="number"
      step={0.1}
      min={0}
      disabled={busy}
      defaultValue={c[key]}
      key={`${c.id}-${key}-${c[key]}`}
      onBlur={(e) => Number(e.target.value) !== c[key] && onEdit([op.updateCaption(c.id, { [key]: Number(e.target.value) })], "Move caption")}
    />
  );
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-2">
      <input
        aria-label="Caption text"
        className={`${FIELD} min-w-[10rem] flex-1`}
        value={text}
        maxLength={200}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text.trim() && text !== c.text && onEdit([op.updateCaption(c.id, { text })], "Edit caption")}
      />
      {num("start")}
      {num("end")}
      <button type="button" className={btnDanger} disabled={busy} onClick={() => onEdit([op.deleteCaption(c.id)], "Delete caption")} aria-label={`Delete caption ${c.text}`}>
        Delete
      </button>
    </li>
  );
}

export function CaptionsPanel({ timeline, playhead, busy, onEdit }: Props) {
  return (
    <section aria-label="Captions" className="space-y-3 rounded-2xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">Captions</h3>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Caption style"
            className={FIELD}
            value={timeline.captionStyle}
            disabled={busy}
            onChange={(e) => onEdit([op.captionStyle(e.target.value)])}
          >
            {CAPTION_STYLES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={btnSecondary}
            disabled={busy}
            onClick={() => onEdit([op.addCaption(playhead, Math.min(playhead + 2, timeline.duration), "New caption")], "Add caption")}
          >
            Add at playhead
          </button>
        </div>
      </div>
      {timeline.captions.length === 0 ? (
        <p className="text-sm text-muted">No captions yet. Add one at the playhead, or generate captions from the Create screen.</p>
      ) : (
        <ul className="space-y-2">
          {timeline.captions.map((c) => (
            <CaptionRow key={`${c.id}-${c.text}-${c.start}-${c.end}`} c={c} busy={busy} onEdit={onEdit} />
          ))}
        </ul>
      )}
    </section>
  );
}
