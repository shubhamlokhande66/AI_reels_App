"use client";

import { useState } from "react";
import type { EdlSegment, EdlTimeline } from "@/types/api";
import { pretty } from "@/lib/editorFx";
import { op } from "@/lib/ops";
import { formatDuration } from "@/lib/format";
import { MusicControls } from "@/components/editor/AudioCaptionsPanel";
import type { Catalog } from "./Gallery";

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3];
type Edit = (ops: object[], label?: string) => void;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 border-b border-border py-3 last:border-0">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      {children}
    </div>
  );
}

function Chip({ on, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { on: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-40 ${on ? "border-accent bg-accent/15 text-accent" : "border-border hover:border-accent/50"}`}
    >
      {children}
    </button>
  );
}

/** Properties of what is selected, like CapCut's right panel: a clip's speed, framing, effect and transition; with
 * nothing selected, the project's filter and music. "Change" opens the matching library on the left. */
export function Inspector({ tl, seg, thumb, catalog, busy, onEdit, openLibrary }: {
  tl: EdlTimeline;
  seg: EdlSegment | null;
  thumb?: string;
  catalog?: Catalog;
  busy: boolean;
  onEdit: Edit;
  openLibrary: (tab: "effects" | "transitions" | "looks" | "text" | "audio") => void;
}) {
  if (!seg) {
    const look = catalog?.looks.find((l) => l.id === tl.colorGrade)?.label ?? "Original";
    return (
      <div>
        <h2 className="pb-1 text-sm font-semibold">Project</h2>
        <p className="text-xs text-muted">
          {tl.segments.length} clips · {formatDuration(tl.duration)} · 9:16. Select a clip on the timeline to edit it.
        </p>
        <Row label="Filter">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>{look}</span>
            <button type="button" className="text-xs text-accent hover:underline" onClick={() => openLibrary("looks")}>
              Change
            </button>
          </div>
        </Row>
        <Row label="Music">
          <MusicControls timeline={tl} busy={busy} onEdit={onEdit} />
        </Row>
      </div>
    );
  }
  return <ClipProps tl={tl} seg={seg} thumb={thumb} busy={busy} onEdit={onEdit} openLibrary={openLibrary} />;
}

const PROP_TABS = [
  ["video", "Video"],
  ["speed", "Speed"],
  ["animation", "Animation"],
] as const;

/** A clip's properties in tabs, like Filmora's property panel: Video (framing, length, effect), Speed, Animation
 * (how it comes in). */
function ClipProps({ tl, seg, thumb, busy, onEdit, openLibrary }: {
  tl: EdlTimeline;
  seg: EdlSegment;
  thumb?: string;
  busy: boolean;
  onEdit: Edit;
  openLibrary: (tab: "effects" | "transitions" | "looks" | "text" | "audio") => void;
}) {
  const [tab, setTab] = useState<(typeof PROP_TABS)[number][0]>("video");
  const idx = tl.segments.indexOf(seg);
  const len = seg.timelineEnd - seg.timelineStart;
  return (
    <div>
      <div className="flex items-center gap-3 pb-2">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" className="h-14 w-10 shrink-0 rounded-md object-cover" />
        ) : (
          <span className="h-14 w-10 shrink-0 rounded-md bg-surface-2" />
        )}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Clip {idx + 1}</h2>
          <p className="truncate text-xs text-muted">{seg.video}</p>
          <p className="text-xs text-muted">
            {len.toFixed(1)} s · from {seg.sourceStart.toFixed(1)} s of the clip
          </p>
        </div>
      </div>
      <div role="tablist" aria-label="Properties" className="mb-1 flex border-b border-border">
        {PROP_TABS.map(([k, l]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`flex-1 border-b-2 py-1.5 text-xs transition-colors ${tab === k ? "border-accent text-accent" : "border-transparent text-muted hover:text-foreground"}`}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === "video" && (
        <>
          <Row label="Framing">
            <div className="flex gap-1.5">
              {(["auto", "fill", "fit"] as const).map((f) => (
                <Chip key={f} on={seg.crop.framing === f} disabled={busy} onClick={() => onEdit([op.framing(seg.id, f)], `Framing: ${f}`)}>
                  {f === "auto" ? "Smart" : f === "fill" ? "Fill" : "Fit"}
                </Chip>
              ))}
            </div>
          </Row>
          <Row label="Length">
            <div className="flex flex-wrap gap-1.5">
              {[0.5, 1, 1.5, 2, 3, 4, 5].map((v) => (
                <Chip key={v} on={Math.abs(len - v) < 0.05} disabled={busy} onClick={() => onEdit([op.setLength(seg.id, v)], `Length ${v} s`)}>
                  {v} s
                </Chip>
              ))}
            </div>
            <p className="text-[11px] text-muted">Or drag the clip&apos;s right edge on the timeline.</p>
          </Row>
          <Row label="Effect">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span>{seg.effect === "none" ? "None" : pretty(seg.effect)}</span>
              <span className="flex gap-3">
                {seg.effect !== "none" && (
                  <button type="button" className="text-xs text-muted hover:text-danger" disabled={busy} onClick={() => onEdit([op.effect(seg.id, "none")], "Remove effect")}>
                    Remove
                  </button>
                )}
                <button type="button" className="text-xs text-accent hover:underline" onClick={() => openLibrary("effects")}>
                  Change
                </button>
              </span>
            </div>
          </Row>
        </>
      )}
      {tab === "speed" && (
        <Row label="Speed">
          <div className="flex flex-wrap gap-1.5">
            {SPEEDS.map((v) => (
              <Chip key={v} on={Math.abs(seg.speed - v) < 0.01} disabled={busy} onClick={() => onEdit([op.speed(seg.id, v)], `Speed ${v}×`)}>
                {v}×
              </Chip>
            ))}
          </div>
          <p className="text-[11px] text-muted">Below 1×: smooth slow motion. Above 1×: faster.</p>
        </Row>
      )}
      {tab === "animation" && (
        <Row label="Transition in">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>
              {idx === 0 ? "— (first clip)" : seg.transitionIn.type === "cut" ? "Cut" : `${pretty(seg.transitionIn.type)} · ${seg.transitionIn.duration.toFixed(1)} s`}
            </span>
            {idx > 0 && (
              <span className="flex gap-3">
                {seg.transitionIn.type !== "cut" && (
                  <button type="button" className="text-xs text-muted hover:text-danger" disabled={busy} onClick={() => onEdit([op.transition(seg.id, "cut")], "Remove transition")}>
                    Remove
                  </button>
                )}
                <button type="button" className="text-xs text-accent hover:underline" onClick={() => openLibrary("transitions")}>
                  Change
                </button>
              </span>
            )}
          </div>
        </Row>
      )}
    </div>
  );
}
