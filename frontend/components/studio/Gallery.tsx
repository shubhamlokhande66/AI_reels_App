"use client";

import { useEffect, useRef, useState } from "react";
import type { EdlOverlay, EdlSegment, EdlTimeline } from "@/types/api";
import { LOOK_CSS, effectStyle, pretty, transitionStyle } from "@/lib/editorFx";
import { op } from "@/lib/ops";
import { CaptionsPanel, MusicControls } from "@/components/editor/AudioCaptionsPanel";
import { btnDanger, btnPrimary, btnSecondary } from "@/components/ui";

export type Catalog = { transitions: string[]; effects: string[]; looks: { id: string; label: string; hint: string }[] };
type Edit = (ops: object[], label?: string) => void;

export const TABS = [
  ["transitions", "Transitions", "⇄"],
  ["effects", "Effects", "✧"],
  ["looks", "Filters", "◐"],
  ["text", "Text", "T"],
  ["speed", "Speed", "⏩"],
  ["adjust", "Adjust", "⛶"],
  ["audio", "Music & captions", "♪"],
] as const;
export type Tab = (typeof TABS)[number][0];

/** A looping 0..1 progress while the tile is hovered (or always, for the selected one): the live preview. */
function useLoop(active: boolean, seconds = 1.4) {
  const [p, setP] = useState(0.5);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (!active) return;
    const t0 = performance.now();
    const tick = () => {
      setP(((performance.now() - t0) / 1000 / seconds) % 1);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [active, seconds]);
  return active ? p : 0.5;
}

function Tile({ label, selected, onClick, disabled, children }: { label: string; selected: boolean; onClick: () => void; disabled?: boolean; children: (hover: boolean) => React.ReactNode }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      className={`group flex flex-col gap-1 rounded-xl border p-1.5 text-left transition-all disabled:opacity-40 ${selected ? "border-accent bg-accent/10" : "border-border hover:border-accent/60"}`}
    >
      <span className="relative block aspect-[9/12] w-full overflow-hidden rounded-lg bg-surface-2">{children(hover || selected)}</span>
      <span className={`truncate px-0.5 text-[11px] ${selected ? "text-accent" : "text-muted group-hover:text-foreground"}`}>{label}</span>
    </button>
  );
}

function Pic({ src, style }: { src?: string; style?: React.CSSProperties }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" style={style} draggable={false} />
  ) : (
    <span className="absolute inset-0 bg-[linear-gradient(135deg,#3a2f22,#8a6d45)]" style={style} />
  );
}

function TransitionTile({ type, a, b, selected, onClick, disabled }: { type: string; a?: string; b?: string; selected: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <Tile label={pretty(type)} selected={selected} onClick={onClick} disabled={disabled}>
      {(on) => <TransitionDemo type={type} a={a} b={b} on={on} />}
    </Tile>
  );
}

function TransitionDemo({ type, a, b, on }: { type: string; a?: string; b?: string; on: boolean }) {
  const p = useLoop(on);
  const st = type === "cut" ? { opacity: p > 0.5 ? 1 : 0 } : transitionStyle(type, Math.min(Math.max((p - 0.2) / 0.6, 0), 1));
  return (
    <>
      <Pic src={a} />
      <span className="absolute inset-0" style={{ opacity: st.opacity, clipPath: st.clipPath, transform: st.transform, filter: st.filter }}>
        <Pic src={b ?? a} style={{ filter: b ? undefined : "hue-rotate(120deg)" }} />
      </span>
    </>
  );
}

function EffectTile({ effect, src, selected, onClick, disabled }: { effect: string; src?: string; selected: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <Tile label={pretty(effect)} selected={selected} onClick={onClick} disabled={disabled}>
      {(on) => <EffectDemo effect={effect} src={src} on={on} />}
    </Tile>
  );
}

function EffectDemo({ effect, src, on }: { effect: string; src?: string; on: boolean }) {
  const p = useLoop(on, 1.6);
  const fx = effectStyle(effect, p, p * 1.6);
  return (
    <>
      <Pic src={src} style={{ transform: fx.transform, filter: fx.filter, transformOrigin: "50% 50%" }} />
      {effect === "vignette" && <span className="absolute inset-0 bg-[radial-gradient(circle,transparent_45%,rgba(0,0,0,0.7))]" />}
    </>
  );
}

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];

function TextTool({ tl, playhead, busy, onEdit }: { tl: EdlTimeline; playhead: number; busy: boolean; onEdit: Edit }) {
  const [text, setText] = useState("");
  const [position, setPosition] = useState<EdlOverlay["position"]>("top");
  const [animation, setAnimation] = useState<EdlOverlay["animation"]>("slide_up");
  const [size, setSize] = useState<EdlOverlay["size"]>("medium");
  const [length, setLength] = useState(2.5);
  const [error, setError] = useState<string | null>(null);
  const list = tl.overlays ?? [];
  const save = (next: EdlOverlay[], label: string) => onEdit([{ type: "set_overlays", overlays: next.map(({ id, ...o }) => ({ ...(id ? { id } : {}), ...o })) }], label);
  function add() {
    setError(null);
    const t = text.trim();
    if (!t) return setError("Type the text first.");
    if (t.split(/\s+/).length > 12) return setError("Keep it short: 12 words at most.");
    const start = Math.min(playhead, Math.max(tl.duration - 0.6, 0));
    save([...list, { text: t, start: +start.toFixed(2), end: +Math.min(start + length, tl.duration).toFixed(2), position, animation, size, role: "text" }], "Add text");
    setText("");
  }
  const SEL = "rounded-lg border border-border bg-surface px-2 py-1.5 text-xs";
  return (
    <div className="space-y-3">
      <input value={text} onChange={(e) => setText(e.target.value)} maxLength={80} placeholder="Your text…" className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
      <div className="grid grid-cols-2 gap-2">
        <select className={SEL} value={position} onChange={(e) => setPosition(e.target.value as EdlOverlay["position"])} aria-label="Position">
          <option value="top">Top</option>
          <option value="center">Middle</option>
          <option value="bottom">Bottom</option>
        </select>
        <select className={SEL} value={size} onChange={(e) => setSize(e.target.value as EdlOverlay["size"])} aria-label="Size">
          <option value="small">Small</option>
          <option value="medium">Medium</option>
          <option value="large">Large</option>
        </select>
        <select className={SEL} value={animation} onChange={(e) => setAnimation(e.target.value as EdlOverlay["animation"])} aria-label="Animation">
          {(["fade", "slide_up", "scale", "type_on", "blur_sharp", "mask_reveal"] as const).map((a) => (
            <option key={a} value={a}>
              {pretty(a)}
            </option>
          ))}
        </select>
        <select className={SEL} value={length} onChange={(e) => setLength(Number(e.target.value))} aria-label="How long">
          {[1.5, 2.5, 4, 6].map((s) => (
            <option key={s} value={s}>
              {s} s
            </option>
          ))}
        </select>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      <button type="button" className={`${btnPrimary} w-full`} disabled={busy} onClick={add}>
        + Add text at {playhead.toFixed(1)} s
      </button>
      {list.length > 0 && (
        <ul className="space-y-1.5">
          {list.map((o, i) => (
            <li key={o.id ?? i} className="flex items-center justify-between gap-2 rounded-lg border border-border px-2 py-1.5 text-xs">
              <span className="min-w-0 truncate">
                “{o.text}” <span className="text-muted">{o.start.toFixed(1)}–{o.end.toFixed(1)} s</span>
              </span>
              <button type="button" className="shrink-0 text-muted hover:text-danger" disabled={busy} onClick={() => save(list.filter((_, j) => j !== i), "Delete text")} aria-label="Delete text">
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The right-hand panel: every professional tool, with live previews on the selected shot's own picture. */
export function Gallery({ tab, catalog, tl, seg, prevThumb, thumb, playhead, busy, onEdit, onSplit, onDuplicate, onDelete }: {
  tab: Tab;
  catalog: Catalog | undefined;
  tl: EdlTimeline;
  seg: EdlSegment | null;
  prevThumb?: string;
  thumb?: string;
  playhead: number;
  busy: boolean;
  onEdit: Edit;
  onSplit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [trDur, setTrDur] = useState(0.5);
  const needShot = <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted">Select a shot on the timeline first.</p>;
  const grid = "grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4";
  if (!catalog && (tab === "transitions" || tab === "effects" || tab === "looks")) return <p className="text-sm text-muted">Loading…</p>;

  if (tab === "transitions") {
    if (!seg) return needShot;
    const first = tl.segments[0]?.id === seg.id;
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted">{first ? "The first shot has no incoming transition: select another shot." : "How this shot comes in. Hover to preview."}</p>
        <label className="flex items-center gap-2 text-xs text-muted">
          Length
          <input type="range" min={0.2} max={1.5} step={0.1} value={trDur} onChange={(e) => setTrDur(Number(e.target.value))} className="flex-1 accent-[var(--accent)]" />
          <span className="w-10 text-right text-foreground">{trDur.toFixed(1)} s</span>
        </label>
        <div className={grid}>
          {catalog!.transitions.map((t) => (
            <TransitionTile
              key={t}
              type={t}
              a={prevThumb}
              b={thumb}
              selected={seg.transitionIn.type === t}
              disabled={busy || first}
              onClick={() => onEdit([op.transition(seg.id, t, t === "cut" ? undefined : trDur)], `Transition: ${pretty(t)}`)}
            />
          ))}
        </div>
      </div>
    );
  }
  if (tab === "effects") {
    if (!seg) return needShot;
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted">A camera move or look for this shot. Hover to preview.</p>
        <div className={grid}>
          {catalog!.effects.map((e) => (
            <EffectTile key={e} effect={e} src={thumb} selected={seg.effect === e} disabled={busy} onClick={() => onEdit([op.effect(seg.id, e)], `Effect: ${pretty(e)}`)} />
          ))}
        </div>
      </div>
    );
  }
  if (tab === "looks") {
    const cur = tl.colorGrade ?? null;
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted">A colour look for the whole Reel.</p>
        <div className={grid}>
          <Tile label="Original" selected={!cur} onClick={() => onEdit([{ type: "set_grade", grade: null }], "No filter")} disabled={busy}>
            {() => <Pic src={thumb} />}
          </Tile>
          {catalog!.looks.map((l) => (
            <Tile key={l.id} label={l.label} selected={cur === l.id} disabled={busy} onClick={() => onEdit([{ type: "set_grade", grade: l.id }], `Filter: ${l.label}`)}>
              {() => <Pic src={thumb} style={{ filter: LOOK_CSS[l.id] }} />}
            </Tile>
          ))}
        </div>
      </div>
    );
  }
  if (tab === "text") return <TextTool tl={tl} playhead={playhead} busy={busy} onEdit={onEdit} />;
  if (tab === "speed") {
    if (!seg) return needShot;
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted">Below 1×: smooth slow motion. Above 1×: speed up.</p>
        <div className="grid grid-cols-4 gap-2">
          {SPEEDS.map((v) => (
            <button
              key={v}
              type="button"
              disabled={busy}
              onClick={() => onEdit([op.speed(seg.id, v)], `Speed ${v}×`)}
              className={`rounded-xl border py-2 text-sm ${Math.abs(seg.speed - v) < 0.01 ? "border-accent bg-accent/10 text-accent" : "border-border hover:border-accent/60"}`}
            >
              {v}×
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (tab === "adjust") {
    if (!seg) return needShot;
    return (
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-xs text-muted">Framing</p>
          <div className="grid grid-cols-3 gap-2">
            {(["auto", "fill", "fit"] as const).map((f) => (
              <button
                key={f}
                type="button"
                disabled={busy}
                onClick={() => onEdit([op.framing(seg.id, f)], `Framing: ${f}`)}
                className={`rounded-xl border py-2 text-sm ${seg.crop.framing === f ? "border-accent bg-accent/10 text-accent" : "border-border hover:border-accent/60"}`}
              >
                {f === "auto" ? "Smart" : f === "fill" ? "Fill (crop)" : "Fit (bars)"}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button type="button" className={btnSecondary} disabled={busy} onClick={onSplit} title="S">
            ✂ Split
          </button>
          <button type="button" className={btnSecondary} disabled={busy} onClick={onDuplicate}>
            ⧉ Duplicate
          </button>
          <button type="button" className={btnDanger} disabled={busy || tl.segments.length <= 1} onClick={onDelete} title="Delete">
            Delete
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={btnSecondary} disabled={busy || tl.segments[0]?.id === seg.id} onClick={() => onEdit([op.move(seg.id, tl.segments.findIndex((x) => x.id === seg.id) - 1)], "Move shot")}>
            ← Move earlier
          </button>
          <button type="button" className={btnSecondary} disabled={busy || tl.segments[tl.segments.length - 1]?.id === seg.id} onClick={() => onEdit([op.move(seg.id, tl.segments.findIndex((x) => x.id === seg.id) + 1)], "Move shot")}>
            Move later →
          </button>
        </div>
        <p className="text-xs text-muted">Drag a shot&apos;s right edge on the timeline to trim it.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <MusicControls timeline={tl} busy={busy} onEdit={onEdit} />
      <CaptionsPanel timeline={tl} playhead={playhead} busy={busy} onEdit={onEdit} />
    </div>
  );
}
