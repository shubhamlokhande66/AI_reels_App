"use client";

import { useState } from "react";
import type { EdlSegment, EdlTimeline } from "@/types/api";
import { pretty } from "@/lib/editorFx";
import { op } from "@/lib/ops";
import { formatDuration } from "@/lib/format";
import { MusicControls } from "@/components/organisms/editor/AudioCaptionsPanel";
import type { Catalog } from "@/components/organisms/studio/Gallery";
import { KeyframePanel } from "@/components/organisms/studio/KeyframePanel";

const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 3];
const LENGTHS = [0.5, 1, 1.5, 2, 3, 5];
type Edit = (ops: object[], label?: string) => void;
type LibOpen = (tab: "effects" | "transitions" | "looks" | "text" | "audio") => void;

/** A group of settings, like the cards in CapCut's right panel. */
function Card({ label, value, children }: { label: string; value?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded-xl border border-border/60 bg-white/[0.03] p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-foreground/90">{label}</h3>
        {value !== undefined && <span className="text-[11px] tabular-nums text-muted">{value}</span>}
      </div>
      {children}
    </section>
  );
}

/** Options side by side in one rounded bar (a segmented control). */
function Segmented<T extends string | number>({ options, value, onPick, disabled, label }: {
  options: { v: T; label: string }[];
  value: T | null;
  onPick: (v: T) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-lg bg-black/30 p-0.5">
      {options.map((o) => (
        <button key={String(o.v)} type="button" role="radio" aria-checked={value === o.v} disabled={disabled} onClick={() => onPick(o.v)}
          className={`flex-1 rounded-md px-1.5 py-1 text-[11px] transition-colors disabled:opacity-40 ${value === o.v ? "bg-accent text-black font-semibold" : "text-muted hover:text-foreground"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** "Effect: Punch  [Remove] [Change]" */
function Picked({ name, onRemove, onChange, busy }: { name: string; onRemove?: () => void; onChange: () => void; busy: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="truncate text-sm">{name}</span>
      <span className="flex shrink-0 gap-1">
        {onRemove && (
          <button type="button" disabled={busy} onClick={onRemove} className="rounded-md px-2 py-1 text-[11px] text-muted hover:bg-danger/10 hover:text-danger">
            Remove
          </button>
        )}
        <button type="button" onClick={onChange} className="rounded-md border border-accent/50 px-2 py-1 text-[11px] text-accent hover:bg-accent/10">
          Change
        </button>
      </span>
    </div>
  );
}

/** Properties of what is selected, like CapCut's right panel: a clip's video, speed and animation in tabs; with
 * nothing selected, the project's filter and music. "Change" opens the matching library on the left. */
export function Inspector({ tl, seg, thumb, catalog, busy, onEdit, openLibrary, playhead, tab, onTab }: {
  /** which clip tab is open (the toolbar's Speed button opens "speed") */
  tab?: ClipTab;
  onTab?: (t: ClipTab) => void;
  playhead?: number;
  tl: EdlTimeline;
  seg: EdlSegment | null;
  thumb?: string;
  catalog?: Catalog;
  busy: boolean;
  onEdit: Edit;
  openLibrary: LibOpen;
}) {
  if (!seg) {
    const look = catalog?.looks.find((l) => l.id === tl.colorGrade)?.label ?? "Original";
    return (
      <div>
        <div className="sticky top-0 z-10 border-b border-border bg-surface px-3 py-2.5">
          <h2 className="text-sm font-semibold">Project</h2>
          <p className="text-[11px] text-muted">
            {tl.segments.length} clips · {formatDuration(tl.duration)} · 9:16 · select a clip to edit it
          </p>
        </div>
        <div className="space-y-2.5 p-3">
          <Card label="Filter">
            <Picked name={look} onChange={() => openLibrary("looks")} busy={busy} />
          </Card>
          <MusicControls timeline={tl} busy={busy} onEdit={onEdit} />
        </div>
      </div>
    );
  }
  return <ClipProps tl={tl} seg={seg} thumb={thumb} busy={busy} onEdit={onEdit} openLibrary={openLibrary} playhead={playhead} tab={tab} onTab={onTab} />;
}

const PROP_TABS = [
  ["video", "Video"],
  ["speed", "Speed"],
  ["animation", "Animation"],
] as const;
export type ClipTab = (typeof PROP_TABS)[number][0];

/** A clip's properties: tabs across the top (Video, Speed, Animation), then cards. */
function ClipProps({ tl, seg, thumb, busy, onEdit, openLibrary, playhead, tab: shown, onTab }: {
  tab?: ClipTab;
  onTab?: (t: ClipTab) => void;
  playhead?: number;
  tl: EdlTimeline;
  seg: EdlSegment;
  thumb?: string;
  busy: boolean;
  onEdit: Edit;
  openLibrary: LibOpen;
}) {
  const [own, setOwn] = useState<ClipTab>("video");
  const tab = shown ?? own;
  const setTab = (t: ClipTab) => (onTab ? onTab(t) : setOwn(t));
  const [speedDraft, setSpeedDraft] = useState<number | null>(null);
  const idx = tl.segments.indexOf(seg);
  const len = seg.timelineEnd - seg.timelineStart;
  const speed = speedDraft ?? seg.speed;
  const commitSpeed = () => {
    if (speedDraft !== null && Math.abs(speedDraft - seg.speed) > 0.01) onEdit([op.speed(seg.id, +speedDraft.toFixed(2))], `Speed ${speedDraft.toFixed(2)}×`);
    setSpeedDraft(null);
  };
  return (
    <div>
      <div className="sticky top-0 z-10 bg-surface">
        <div role="tablist" aria-label="Properties" className="flex border-b border-border">
          {PROP_TABS.map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`flex-1 border-b-2 py-2.5 text-xs font-medium transition-colors ${tab === k ? "border-accent text-accent" : "border-transparent text-muted hover:text-foreground"}`}>
              {l}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" className="h-9 w-6 shrink-0 rounded object-cover" />
          ) : (
            <span className="h-9 w-6 shrink-0 rounded bg-surface-2" />
          )}
          <div className="min-w-0 text-[11px] leading-tight">
            <p className="font-semibold text-foreground">
              Clip {idx + 1} <span className="font-normal text-muted">· {len.toFixed(1)} s · from {seg.sourceStart.toFixed(1)} s</span>
            </p>
            <p className="truncate text-muted" title={seg.video}>{seg.video}</p>
          </div>
        </div>
      </div>

      <div className="space-y-2.5 p-3">
        {tab === "video" && (
          <>
            <Card label="Framing">
              <Segmented label="Framing" disabled={busy} value={seg.crop.framing}
                options={[{ v: "auto", label: "Smart" }, { v: "fill", label: "Fill" }, { v: "fit", label: "Fit" }]}
                onPick={(f) => onEdit([op.framing(seg.id, f)], `Framing: ${f}`)} />
            </Card>
            <Card label="Length" value={`${len.toFixed(1)} s`}>
              <Segmented label="Length" disabled={busy} value={LENGTHS.find((v) => Math.abs(len - v) < 0.05) ?? null}
                options={LENGTHS.map((v) => ({ v, label: `${v}s` }))} onPick={(v) => onEdit([op.setLength(seg.id, v)], `Length ${v} s`)} />
              <p className="text-[10px] text-muted">Or drag the clip&apos;s edge on the timeline (it snaps to the beats).</p>
            </Card>
            <Card label="Effect">
              <Picked name={seg.effect === "none" ? "None" : pretty(seg.effect)} busy={busy} onChange={() => openLibrary("effects")}
                onRemove={seg.effect !== "none" ? () => onEdit([op.effect(seg.id, "none")], "Remove effect") : undefined} />
            </Card>
            <Card label="Motion (keyframes)">
              <KeyframePanel key={`${seg.id}:${JSON.stringify(seg.keyframes ?? [])}`} seg={seg} playhead={playhead} busy={busy} onEdit={onEdit} />
            </Card>
          </>
        )}
        {tab === "speed" && (
          <Card label="Speed" value={`${speed.toFixed(2)}×`}>
            <input type="range" min={0.25} max={3} step={0.05} value={speed} disabled={busy} aria-label="Speed"
              className="w-full accent-[var(--accent)]" onChange={(e) => setSpeedDraft(Number(e.target.value))}
              onPointerUp={commitSpeed} onKeyUp={commitSpeed} onBlur={commitSpeed} />
            <Segmented label="Speed presets" disabled={busy} value={SPEEDS.find((v) => Math.abs(seg.speed - v) < 0.01) ?? null}
              options={SPEEDS.map((v) => ({ v, label: `${v}×` }))} onPick={(v) => onEdit([op.speed(seg.id, v)], `Speed ${v}×`)} />
            <p className="text-[10px] text-muted">Below 1×: smooth slow motion. Above 1×: faster. Speed ramps are in Video → Motion.</p>
          </Card>
        )}
        {tab === "animation" && (
          <Card label="Transition in" value={idx > 0 && seg.transitionIn.type !== "cut" ? `${seg.transitionIn.duration.toFixed(1)} s` : undefined}>
            {idx === 0 ? (
              <p className="text-sm text-muted">The first clip has no transition in.</p>
            ) : (
              <Picked name={seg.transitionIn.type === "cut" ? "Cut" : pretty(seg.transitionIn.type)} busy={busy} onChange={() => openLibrary("transitions")}
                onRemove={seg.transitionIn.type !== "cut" ? () => onEdit([op.transition(seg.id, "cut")], "Remove transition") : undefined} />
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
