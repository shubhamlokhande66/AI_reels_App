"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EdlTimeline, BeatMarker, MarkerDensity, MarkerKind } from "@/types/api";
import { op } from "@/lib/ops";
import { pretty } from "@/lib/editorFx";

const HEAD = 76; // px: the track header column
const GAP = 12; // px between the header column and 0:00, so the first clip does not start under it
const MIN_LEN = 0.25;

type Drag =
  | { kind: "trim"; id: string; x0: number; len0: number; len: number }
  | { kind: "move"; id: string; x0: number; dx: number }
  | { kind: "playhead" }
  | null;

/** A professional timeline (Filmora / Premiere style): a time ruler, track headers (Text, Video, Music), clips drawn as
 * filmstrips of their picture, transition markers between clips, a playhead you can drag, and a zoom slider. Click a
 * clip to select it, drag it to reorder, drag its right edge to trim; every change goes to the server as one edit. */
const DENSITY_KINDS: Record<MarkerDensity, MarkerKind[]> = {
  both: ["strong", "medium", "drop", "custom"], strong: ["strong", "drop", "custom"], drops: ["drop", "custom"],
};
const DENSITY_LABEL: Record<MarkerDensity, string> = { both: "Strong + medium", strong: "Strong only", drops: "Drops only" };
type TrackCode = "T1" | "V1" | "A1";
const TRACK_H: Record<TrackCode, number> = { T1: 34, V1: 84, A1: 72 }; // px, starting heights (drag a track's bottom edge)
const TRACK_MIN: Record<TrackCode, number> = { T1: 24, V1: 44, A1: 36 };
const TRACK_MAX = 220;
function savedHeights(): Record<TrackCode, number> {
  try {
    const v = JSON.parse(localStorage.getItem("editor.trackHeights") ?? "null");
    if (v && typeof v === "object") return { ...TRACK_H, ...v };
  } catch {
    /* no storage: the starting heights */
  }
  return TRACK_H;
}
const SNAP = 0.1; // a dragged edge this close to a marker sticks to it (hold Alt to place it freely)
const MARK: Record<MarkerKind, { size: number; color: string; label: string }> = {
  strong: { size: 8, color: "#facc15", label: "Strong beat" }, medium: { size: 5, color: "#c68bff", label: "Medium beat" },
  drop: { size: 10, color: "#ef4444", label: "Drop" }, custom: { size: 7, color: "#38bdf8", label: "Your marker" },
};

export function ProTimeline({ tl, selectedId, onSelect, playhead, onSeek, thumbs, musicName, busy, onEdit, onTransitionClick, markers, onAddMarker, onRemoveMarker, onAutoCut, beatHint, waveform, tools, onAddVideo, onAddAudio }: {
  markers?: BeatMarker[];
  /** shown instead of the beat tools while there are no markers (no song yet, or its beats being found) */
  beatHint?: string;
  /** the edit tools (undo, split...), shown at the left of the control row */
  tools?: React.ReactNode;
  /** the + at the end of the video / music track */
  onAddVideo?: () => void;
  onAddAudio?: () => void;
  waveform?: { perSecond: number; peaks: number[] };
  onAddMarker?: (t: number) => void;
  onRemoveMarker?: (t: number) => void;
  onAutoCut?: (density: MarkerDensity) => void;
  tl: EdlTimeline;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  playhead: number;
  onSeek: (t: number) => void;
  thumbs: Record<string, string | undefined>;
  musicName?: string;
  busy: boolean;
  onEdit: (ops: object[], label?: string) => void;
  onTransitionClick: (segmentId: string) => void;
}) {
  const [pps, setPps] = useState(60); // pixels per second (the zoom)
  const [drag, setDrag] = useState<Drag>(null);
  const [density, setDensity] = useState<MarkerDensity>("both");
  const [magnet, setMagnet] = useState(true);
  // the timeline is drawn only in the browser (after the edit loads), so the saved heights can be read straight away
  const [heights, setHeights] = useState<Record<TrackCode, number>>(() => (typeof window === "undefined" ? TRACK_H : savedHeights()));
  const resizeTrack = (code: TrackCode, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const y0 = e.clientY;
    const h0 = heights[code];
    let last = heights;
    const move = (ev: PointerEvent) =>
      setHeights((cur) => (last = { ...cur, [code]: Math.round(Math.min(Math.max(h0 + ev.clientY - y0, TRACK_MIN[code]), TRACK_MAX)) }));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      try {
        localStorage.setItem("editor.trackHeights", JSON.stringify(last));
      } catch {
        /* not kept: fine */
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const shownMarks = (markers ?? []).filter((m) => DENSITY_KINDS[density].includes(m.kind) && m.t >= 0 && m.t <= tl.duration);
  /** A time stuck to the nearest shown marker (within SNAP), unless the magnet is off or Alt is held. */
  const snapTo = (t: number, free: boolean) => {
    if (!magnet || free || !shownMarks.length) return t;
    let best = t;
    let gap = SNAP;
    for (const m of shownMarks) if (Math.abs(m.t - t) <= gap) [best, gap] = [m.t, Math.abs(m.t - t)];
    return best;
  };
  const area = useRef<HTMLDivElement>(null);
  const fitted = useRef(false);
  const ppsNow = useRef(60);
  /** while zooming: the time that must stay under the same spot of the view (the mouse, or the playhead) */
  const anchor = useRef<{ t: number; offset: number } | null>(null);
  /** The zoom at which the whole Reel fills the timeline's width. */
  const fitPps = () => {
    const w = area.current?.clientWidth ?? 0;
    return w > HEAD + 80 ? Math.min(Math.max((w - HEAD - GAP - 24) / Math.max(tl.duration, 1), 10), 240) : null;
  };
  // by default the clips and the music fill the full width (and keep filling it as the window resizes, until you zoom)
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (fitted.current) return;
      const v = fitPps();
      if (v) setPps(v);
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tl.duration]);
  const total = Math.max(tl.duration, 1);
  const width = Math.max(total * pps + 120, 300);
  const x = (t: number) => t * pps;

  // ruler: a tick every second (or 5 s when zoomed out), a label every few ticks
  const step = pps >= 40 ? 1 : pps >= 15 ? 2 : 5;
  const ticks: number[] = [];
  for (let t = 0; t <= total + step; t += step) ticks.push(t);

  const timeAt = (clientX: number) => {
    const r = area.current?.getBoundingClientRect();
    if (!r) return 0;
    return Math.min(Math.max((clientX - r.left + (area.current?.scrollLeft ?? 0) - HEAD - GAP) / pps, 0), tl.duration);
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      if (drag.kind === "playhead") onSeek(timeAt(e.clientX));
      else if (drag.kind === "trim") {
        const seg = tl.segments.find((s) => s.id === drag.id);
        const raw = Math.max(drag.len0 + (e.clientX - drag.x0) / pps, MIN_LEN);
        const end = seg ? snapTo(seg.timelineStart + raw, e.altKey) : raw; // the edge sticks to a beat marker
        setDrag({ ...drag, len: Math.max(seg ? end - seg.timelineStart : raw, MIN_LEN) });
      }
      else setDrag({ ...drag, dx: e.clientX - drag.x0 });
    };
    const onUp = () => {
      if (drag.kind === "trim" && Math.abs(drag.len - drag.len0) > 0.04) onEdit([op.setLength(drag.id, +drag.len.toFixed(3))], "Trim");
      if (drag.kind === "move" && Math.abs(drag.dx) > 8) {
        const from = tl.segments.findIndex((s) => s.id === drag.id);
        const seg = tl.segments[from];
        const centre = (seg.timelineStart + seg.timelineEnd) / 2 + drag.dx / pps;
        let to = tl.segments.findIndex((s) => centre < (s.timelineStart + s.timelineEnd) / 2);
        if (to === -1) to = tl.segments.length - 1;
        else if (to > from) to -= 1;
        if (to !== from) onEdit([op.move(drag.id, to)], "Move clip");
      }
      setDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => window.removeEventListener("pointermove", onMove);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, pps]);

  // touchpad pinch (Ctrl + wheel) zooms the timeline, not the page: needs a non-passive listener to be allowed to cancel it
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      fitted.current = true;
      const r = el.getBoundingClientRect();
      const offset = e.clientX - r.left; // zoom around the point under the mouse
      anchor.current = { t: Math.max((el.scrollLeft + offset - HEAD - GAP) / ppsNow.current, 0), offset };
      setPps((v) => Math.min(Math.max(v * Math.exp(-e.deltaY * 0.01), 10), 240));
    };
    el.addEventListener("wheel", onWheel, { passive: false });

    // phones: a two-finger pinch on the clips or the music zooms the timeline around the fingers, never the page
    let pinch: { distance: number; pps: number } | null = null;
    const fingers = (e: TouchEvent) => {
      const [a, b] = [e.touches[0], e.touches[1]];
      return { distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), mid: (a.clientX + b.clientX) / 2 };
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      pinch = { distance: Math.max(fingers(e).distance, 1), pps: ppsNow.current };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      fitted.current = true;
      const { distance, mid } = fingers(e);
      const offset = mid - el.getBoundingClientRect().left;
      anchor.current = { t: Math.max((el.scrollLeft + offset - HEAD - GAP) / ppsNow.current, 0), offset };
      setPps(Math.min(Math.max(pinch.pps * (distance / pinch.distance), 10), 240));
    };
    const onTouchEnd = (e: TouchEvent) => { if (e.touches.length < 2) pinch = null; };
    // iPhone Safari zooms the page with its own gesture events: stop them over the timeline
    const onGesture = (e: Event) => e.preventDefault();
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    el.addEventListener("gesturestart", onGesture, { passive: false });
    el.addEventListener("gesturechange", onGesture, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("gesturestart", onGesture);
      el.removeEventListener("gesturechange", onGesture);
    };
  }, []);

  // after a zoom: the anchored time back under the same spot (so zooming never jumps to the start)
  useLayoutEffect(() => {
    ppsNow.current = pps;
    const el = area.current;
    const a = anchor.current;
    anchor.current = null;
    if (el && a) el.scrollLeft = Math.max(HEAD + GAP + a.t * pps - a.offset, 0);
  }, [pps]);

  // keep the playhead in view when it moves (playing, seeking) - not when zooming
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const px = HEAD + GAP + x(playhead);
    if (px < el.scrollLeft + HEAD || px > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = Math.max(px - el.clientWidth / 3, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playhead]);


  return (
    <div className="select-none">
      <div className="mb-1 flex flex-wrap items-center justify-end gap-2 px-1 text-[10px] text-muted">
        {tools && <div className="mr-auto flex items-center gap-0.5">{tools}</div>}
        {!markers && beatHint && <span className={`${tools ? "" : "mr-auto "}text-[10px] text-muted`}>♪ {beatHint}</span>}
        {markers && (
          <>
            <label className="flex items-center gap-1">
              Beat markers
              <select className="rounded border border-border bg-surface px-1 py-0.5 text-[10px]" value={density} onChange={(e) => setDensity(e.target.value as MarkerDensity)}>
                {(Object.keys(DENSITY_LABEL) as MarkerDensity[]).map((d) => <option key={d} value={d}>{DENSITY_LABEL[d]}</option>)}
              </select>
            </label>
            <button type="button" aria-pressed={magnet} title="Clip edges stick to the markers while you trim (hold Alt to place freely)"
              className={`rounded border px-1.5 py-0.5 ${magnet ? "border-accent text-accent" : "border-border"}`} onClick={() => setMagnet((m) => !m)}>
              🧲 Snap {magnet ? "on" : "off"}
            </button>
            {onAddMarker && (
              <button type="button" className="rounded border border-border px-1.5 py-0.5 hover:text-foreground" disabled={busy} onClick={() => onAddMarker(playhead)}>
                + Marker at playhead
              </button>
            )}
            {onAutoCut && (
              <button type="button" className="rounded border border-accent/60 px-1.5 py-0.5 text-accent hover:bg-accent/10" disabled={busy}
                title="Re-cut your clips onto these markers (one undoable step)" onClick={() => onAutoCut(density)}>
                ✂ Auto-cut to {DENSITY_LABEL[density].toLowerCase()}
              </button>
            )}
            <span className="mx-1 h-3 w-px bg-border" />
          </>
        )}
        <button type="button" title="Fit the whole Reel to the width" className="rounded border border-border px-1.5 py-0.5 hover:text-foreground"
          onClick={() => {
            fitted.current = false;
            const v = fitPps();
            if (v) setPps(v);
          }}>
          ⇔ Fit
        </button>
      </div>
      <div
        ref={area}
        // one finger scrolls; a pinch is the timeline's own zoom (handled above), not the browser's page zoom
        style={{ touchAction: "pan-x pan-y" }}
        className="relative overflow-x-auto overflow-y-hidden rounded-lg border border-border bg-background"
      >
        <div className="relative" style={{ width: width + HEAD + GAP }}>
          {/* ruler */}
          <div
            className="sticky top-0 z-10 flex h-6 border-b border-border bg-surface"
            onPointerDown={(e) => {
              onSeek(timeAt(e.clientX));
              setDrag({ kind: "playhead" });
            }}
          >
            <div className="sticky left-0 z-40 shrink-0 border-r border-border bg-surface" style={{ width: HEAD + GAP }} />
            <div className="relative flex-1 cursor-pointer">
              {ticks.map((t) => (
                <span key={t} className="absolute top-0 h-full border-l border-border/80" style={{ left: x(t) }}>
                  <span className="absolute left-1 top-0.5 text-[9px] tabular-nums text-muted">
                    {Math.floor(t / 60)}:{String(Math.floor(t % 60)).padStart(2, "0")}
                  </span>
                </span>
              ))}
            </div>
          </div>

          {/* tracks */}
          {(
            [
              // compact tracks on short laptop screens, roomier on tall ones
              ["T1", "Text"],
              ["V1", "Video"],
              ["A1", "Music"],
            ] as const
          ).map(([code, name]) => (
            <div key={code} className="relative flex border-b border-border" style={{ height: heights[code] }}>
              <div className="sticky left-0 z-40 flex shrink-0 items-center gap-1.5 border-r border-border bg-surface px-2 text-[10px] text-muted" style={{ width: HEAD }}>
                <span className="rounded bg-surface-2 px-1 font-mono text-[9px] text-foreground">{code}</span>
                {name}
              </div>
              {/* drag the bottom edge to make the track taller or shorter (double-click: back to the start height) */}
              <div role="separator" aria-orientation="horizontal" aria-label={`Resize the ${name} track`} title="Drag to resize the track (double-click to reset)"
                className="absolute inset-x-0 -bottom-1 z-20 h-2 cursor-row-resize hover:bg-accent/40"
                onPointerDown={(e) => resizeTrack(code, e)}
                onDoubleClick={() => setHeights((cur) => ({ ...cur, [code]: TRACK_H[code] }))} />
              <div className="relative ml-3 flex-1" onPointerDown={(e) => e.target === e.currentTarget && onSelect(null)}>
                {code === "V1" &&
                  tl.segments.map((s, i) => {
                    const sel = s.id === selectedId;
                    const len = drag?.kind === "trim" && drag.id === s.id ? drag.len : s.timelineEnd - s.timelineStart;
                    const dx = drag?.kind === "move" && drag.id === s.id ? drag.dx : 0;
                    const thumb = thumbs[s.clipId];
                    return (
                      <div
                        key={s.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`Clip ${i + 1}: ${s.video}, ${len.toFixed(1)} seconds`}
                        aria-pressed={sel}
                        onPointerDown={(e) => {
                          if (busy) return;
                          onSelect(s.id);
                          setDrag({ kind: "move", id: s.id, x0: e.clientX, dx: 0 });
                        }}
                        onKeyDown={(e) => e.key === "Enter" && onSelect(s.id)}
                        className={`absolute inset-y-1 cursor-grab overflow-hidden rounded-md border-2 active:cursor-grabbing ${sel ? "z-10 border-accent" : "border-transparent hover:border-white/30"}`}
                        style={{
                          left: x(s.timelineStart) + dx,
                          width: Math.max(x(len) - 2, 6),
                          backgroundImage: thumb ? `url(${thumb})` : undefined,
                          backgroundColor: "#2a2a30",
                          backgroundSize: "auto 100%",
                          backgroundRepeat: "repeat-x",
                          opacity: dx ? 0.85 : 1,
                        }}
                      >
                        <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 text-[9px] text-white">
                          {s.video} · {len.toFixed(1)}s{s.speed !== 1 ? ` · ${s.speed}×` : ""}{s.effect !== "none" ? ` · ${pretty(s.effect)}` : ""}
                        </span>
                        {/* trim handle */}
                        <span
                          className={`absolute inset-y-0 right-0 w-2 cursor-ew-resize ${sel ? "bg-accent" : "bg-white/20"} hover:bg-accent`}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            if (busy) return;
                            onSelect(s.id);
                            setDrag({ kind: "trim", id: s.id, x0: e.clientX, len0: s.timelineEnd - s.timelineStart, len: s.timelineEnd - s.timelineStart });
                          }}
                          aria-hidden
                        />
                      </div>
                    );
                  })}
                {code === "V1" &&
                  tl.segments.slice(1).map((s) => (
                    <button
                      key={`tr-${s.id}`}
                      type="button"
                      title={s.transitionIn.type === "cut" ? "Add a transition" : `${pretty(s.transitionIn.type)} · ${s.transitionIn.duration.toFixed(1)}s`}
                      onClick={() => {
                        onSelect(s.id);
                        onTransitionClick(s.id);
                      }}
                      className={`absolute top-1/2 z-20 grid h-5 w-5 -translate-x-1/2 -translate-y-1/2 rotate-45 place-items-center rounded-sm border text-[8px] ${
                        s.transitionIn.type === "cut" ? "border-border bg-surface text-muted opacity-60 hover:opacity-100" : "border-accent bg-accent text-black"
                      }`}
                      style={{ left: x(s.timelineStart) }}
                    >
                      <span className="-rotate-45">{s.transitionIn.type === "cut" ? "+" : "⇄"}</span>
                    </button>
                  ))}
                {code === "T1" &&
                  [...(tl.overlays ?? []), ...tl.captions.map((c) => ({ ...c, caption: true }))].map((o, i) => (
                    <div
                      key={`t${i}`}
                      className={`absolute inset-y-1 truncate rounded px-1 text-[9px] leading-6 ${"caption" in o ? "bg-sky-500/30 text-sky-100" : "bg-fuchsia-500/35 text-fuchsia-100"}`}
                      style={{ left: x(o.start), width: Math.max(x(o.end - o.start), 6) }}
                      title={o.text}
                    >
                      {o.text}
                    </div>
                  ))}
                {code === "A1" && (
                  <div className="absolute inset-y-1 left-0 overflow-hidden rounded bg-emerald-600/30" style={{ width: x(tl.duration) }}>
                    {waveform && waveform.peaks.length > 1 && (
                      // the music's amplitude, bar by bar (like CapCut): a louder moment is a taller bar
                      <svg className="pointer-events-none absolute inset-0 h-full" width={x(tl.duration)} viewBox={`0 0 ${waveform.peaks.length} 100`} preserveAspectRatio="none" aria-hidden>
                        <defs>
                          <linearGradient id="wave-fill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="rgba(167,243,208,0.85)" />
                            <stop offset="100%" stopColor="rgba(16,185,129,0.35)" />
                          </linearGradient>
                        </defs>
                        {(() => {
                          // a smooth wave (the level, lightly smoothed) rising from one flat line at the bottom
                          const pk = waveform.peaks;
                          const lv = pk.map((_, i) => {
                            let sum = 0, n = 0;
                            for (let k = Math.max(i - 2, 0); k <= Math.min(i + 2, pk.length - 1); k++) { sum += pk[k]; n++; }
                            return Math.max(Math.pow(Math.max(sum / n, pk[i] * 0.85), 0.8) * 80, 1);
                          });
                          const top = lv.map((h, i) => `${i === 0 ? "M" : "L"}${i} ${(98 - h).toFixed(1)}`).join("");
                          return (
                            <>
                              <path d={`${top}L${pk.length - 1} 98L0 98Z`} fill="url(#wave-fill)" />
                              <path d={top} fill="none" stroke="rgba(209,250,229,0.9)" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
                              <rect x={0} y={97.5} width={pk.length} height={1} fill="rgba(167,243,208,0.6)" />
                            </>
                          );
                        })()}
                      </svg>
                    )}
                    {shownMarks.map((m, k) => (
                      // the real beats of the Reel's part of the song: big = bar start, red = drop, blue = yours (click to remove)
                      <button key={k} type="button" disabled={busy || !onRemoveMarker}
                        title={`${MARK[m.kind].label}${m.barStart ? " (bar start)" : ""} ${m.t.toFixed(3)}s${onRemoveMarker ? " (click to remove)" : ""}`}
                        onClick={(e) => { e.stopPropagation(); onRemoveMarker?.(m.t); }}
                        className="absolute bottom-0 -translate-x-1/2 translate-y-1/2 rounded-full ring-1 ring-black/40"
                        style={{ left: x(m.t), width: MARK[m.kind].size + (m.barStart ? 2 : 0), height: MARK[m.kind].size + (m.barStart ? 2 : 0), background: MARK[m.kind].color }} />
                    ))}
                    <span className="absolute left-1 top-0.5 truncate text-[9px] text-emerald-50">♪ {musicName ?? "No music"}{tl.bpm ? ` · ${Math.round(tl.bpm)} BPM` : ""}</span>
                  </div>
                )}
              </div>
              {((code === "V1" && onAddVideo) || (code === "A1" && onAddAudio)) && (
                // + stays at the right edge of the view while you zoom or scroll
                <div className="sticky right-0 z-[35] flex shrink-0 items-center bg-gradient-to-l from-background via-background/90 to-transparent py-1 pl-3 pr-1.5">
                  <button type="button" disabled={busy} onClick={code === "V1" ? onAddVideo : onAddAudio}
                    title={code === "V1" ? "Add video clips at the end" : "Add or replace the music"} aria-label={code === "V1" ? "Add video" : "Add music"}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-white/25 bg-surface-2 text-lg text-foreground shadow-lg transition-colors hover:border-accent hover:bg-accent hover:text-black disabled:opacity-40">
                    +
                  </button>
                </div>
              )}
            </div>
          ))}

          {/* playhead */}
          <div className="pointer-events-none absolute bottom-0 top-0 z-30 w-px bg-accent" style={{ left: HEAD + GAP + x(playhead) }}>
            <span
              className="pointer-events-auto absolute -left-[6px] top-0 h-3 w-[13px] cursor-ew-resize rounded-b bg-accent"
              onPointerDown={(e) => {
                e.stopPropagation();
                setDrag({ kind: "playhead" });
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
