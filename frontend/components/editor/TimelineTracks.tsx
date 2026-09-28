"use client";

import { useEffect, useRef, useState } from "react";
import { CUT_TOLERANCE, nearestOffset, snapPoints } from "@/lib/beats";
import { op } from "@/lib/ops";
import type { EdlTimeline, ReelPlan } from "@/types/api";

interface Props {
  timeline: EdlTimeline;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  playhead: number;
  onSeek: (t: number) => void;
  thumbs?: Record<string, string | undefined>;
  musicName?: string;
  music?: ReelPlan["music"];
  musicStale?: boolean;
  /** Turns on zoom, drag-to-trim and a music nudge — off by default so existing pages that don't ask for it look untouched. */
  interactive?: boolean;
  onEdit?: (ops: object[], label?: string) => void;
  busy?: boolean;
}

const hue = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const pct = (v: number, total: number) => `${Math.min(Math.max((v / Math.max(total, 0.001)) * 100, 0), 100)}%`;

const ROW = "relative h-12 rounded-lg bg-surface-2/60";
const LABEL = "flex h-12 w-16 shrink-0 items-center text-xs text-muted sm:w-20";
const LEVEL_HEIGHT: Record<number, string> = { 1: "h-1.5 opacity-40", 2: "h-2.5 opacity-60", 3: "h-4 opacity-90", 4: "h-full" };
const BASE_MIN_WIDTH = 640; // px, matches the fixed width every page used before zoom existed
const MIN_ZOOM = 1;
const MAX_ZOOM = 10;
const MIN_SEGMENT = 0.25; // seconds; matches the backend's own floor
const FRAME = 1 / 30; // seconds; the arrow-key nudge step
const BIG_STEP = 1; // seconds; Shift+arrow

/** The EDL as tracks: video, effects/transitions, music, text. Positions are exact and shared by all tracks.
 * With `interactive`: pinch (touch) or Ctrl/trackpad-pinch + scroll zooms the timeline like a map, not a button; the left/
 * right arrow keys nudge the playhead (hold Shift for a bigger step); dragging a shot's right edge trims it (the shots
 * after it shift to follow); and there's a small control to nudge where the song starts. */
export function TimelineTracks({
  timeline: tl,
  selectedId,
  onSelect,
  playhead,
  onSeek,
  thumbs = {},
  musicName,
  music,
  musicStale,
  interactive,
  onEdit,
  busy,
}: Props) {
  const total = tl.duration;
  const ticks = Array.from({ length: Math.floor(total) + 1 }, (_, i) => i);
  const snap = snapPoints(music);
  const cuts = tl.segments.slice(1).map((s) => s.timelineStart); // internal cuts only: the Reel's own start/end are not judged
  const [zoom, setZoom] = useState<number>(1);
  const [drag, setDrag] = useState<{ id: string; previewLength: number } | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragActiveRef = useRef(false); // a trusted mouse click fires both a pointerdown and a mousedown; only start once
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  const editable = interactive && !!onEdit;

  function seekFromClick(e: React.MouseEvent<HTMLDivElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    onSeek(Math.min(Math.max(((e.clientX - box.left) / box.width) * total, 0), total));
  }

  // Gesture zoom only (no buttons): Ctrl/Cmd + scroll and a trackpad pinch both arrive as wheel events with ctrlKey set
  // (that is how Chrome and Firefox report a trackpad pinch); a real touchscreen pinch arrives as two touch points.
  useEffect(() => {
    if (!interactive) return;
    const el = containerRef.current;
    if (!el) return;

    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey) return; // a plain two-finger scroll should still pan/scroll the page normally
      e.preventDefault();
      setZoom((z) => Math.min(Math.max(z * Math.exp(-e.deltaY * 0.01), MIN_ZOOM), MAX_ZOOM));
    }
    function dist(t: TouchList) {
      return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    }
    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) pinchRef.current = { distance: dist(e.touches), zoom };
    }
    function onTouchMove(e: TouchEvent) {
      if (e.touches.length !== 2 || !pinchRef.current) return;
      e.preventDefault();
      const scale = dist(e.touches) / pinchRef.current.distance;
      setZoom(Math.min(Math.max(pinchRef.current.zoom * scale, MIN_ZOOM), MAX_ZOOM));
    }
    function onTouchEnd(e: TouchEvent) {
      if (e.touches.length < 2) pinchRef.current = null;
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive]);

  // Left / right arrow keys move the playhead (hold Shift for a bigger step) — the laptop-keyboard equivalent of scrubbing.
  useEffect(() => {
    if (!interactive) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      e.preventDefault();
      const step = (e.shiftKey ? BIG_STEP : FRAME) * (e.key === "ArrowLeft" ? -1 : 1);
      onSeek(Math.min(Math.max(playhead + step, 0), total));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive, playhead, total]);

  function startTrim(e: React.PointerEvent | React.MouseEvent, segId: string, startLength: number) {
    if (!editable || busy || dragActiveRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const box = trackRef.current?.getBoundingClientRect();
    if (!box) return;
    dragActiveRef.current = true;
    const startX = e.clientX;
    setDrag({ id: segId, previewLength: startLength });

    // Real mice/touch/pen fire pointer events; some automated or older input paths only fire plain mouse events —
    // listen for both so dragging always works, and clean up whichever pair actually fired.
    function move(clientX: number) {
      const deltaSeconds = ((clientX - startX) / box!.width) * total;
      setDrag({ id: segId, previewLength: Math.max(startLength + deltaSeconds, MIN_SEGMENT) });
    }
    function finish(clientX: number) {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      const deltaSeconds = ((clientX - startX) / box!.width) * total;
      const length = Math.max(startLength + deltaSeconds, MIN_SEGMENT);
      setDrag(null);
      dragActiveRef.current = false;
      if (Math.abs(length - startLength) >= 0.05) onEdit!([op.setLength(segId, Math.round(length * 1000) / 1000)], "Trim shot");
    }
    const onPointerMove = (ev: PointerEvent) => move(ev.clientX);
    const onPointerUp = (ev: PointerEvent) => finish(ev.clientX);
    const onMouseMove = (ev: MouseEvent) => move(ev.clientX);
    const onMouseUp = (ev: MouseEvent) => finish(ev.clientX);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  function nudgeMusic(delta: number) {
    if (!editable) return;
    onEdit!([op.music({ audioStart: Math.max(tl.audioStart + delta, 0) })], "Shift music");
  }

  return (
    <div ref={containerRef} className="overflow-x-auto rounded-2xl border border-border bg-surface p-3" aria-label="Timeline">
      {interactive && (
        <div className="mb-2 flex items-center justify-between gap-2 px-1">
          <span aria-live="polite" className="text-[11px] tabular-nums text-muted">
            {Math.round(zoom * 100)}% · pinch or Ctrl/⌘ + scroll to zoom · ← → to move
          </span>
          {editable && <span className="text-[11px] text-muted">Drag a shot&apos;s right edge to trim it</span>}
        </div>
      )}
      <div className="space-y-2" style={{ minWidth: interactive ? BASE_MIN_WIDTH * zoom : BASE_MIN_WIDTH }}>
        {/* ruler */}
        <div className="flex gap-2">
          <div className="w-16 shrink-0 sm:w-20" />
          <div className="relative h-5 flex-1 cursor-pointer" onClick={seekFromClick} aria-hidden>
            {ticks.map((t) => (
              <span key={t} className="absolute top-0 -translate-x-1/2 text-[10px] tabular-nums text-muted" style={{ left: pct(t, total) }}>
                {t % (total > 30 ? 5 : total > 15 ? 2 : 1) === 0 ? `${t}s` : ""}
              </span>
            ))}
          </div>
        </div>

        <div className="relative space-y-2">
          {/* beats: every beat and real strong accent, so you can see whether a cut actually lands on one */}
          {music && (
            <div className="flex gap-2">
              <div className={LABEL}>Beat</div>
              <div className="relative h-6 flex-1 cursor-pointer" onClick={seekFromClick}>
                {music.beats.map((b) => (
                  <button
                    key={b.t}
                    type="button"
                    aria-label={`Go to the beat at ${b.t.toFixed(2)}s`}
                    title={`${b.t.toFixed(2)}s · ${["", "subtle", "normal", "strong", "major hit"][b.level] ?? "beat"} beat — click to jump here`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSeek(b.t);
                    }}
                    className="absolute inset-y-0 -translate-x-1/2 px-1"
                    style={{ left: pct(b.t, total) }}
                  >
                    <span className={`block w-px bg-muted hover:bg-accent ${LEVEL_HEIGHT[b.level] ?? LEVEL_HEIGHT[1]}`} />
                  </button>
                ))}
                {music.accents
                  .filter((a) => a.strength >= 0.6 && !music.beats.some((b) => Math.abs(b.t - a.t) < 0.02))
                  .map((a) => (
                    <button
                      key={`a${a.t}`}
                      type="button"
                      aria-label={`Go to the strong accent at ${a.t.toFixed(2)}s`}
                      title={`${a.t.toFixed(2)}s · strong accent (off the beat grid) — click to jump here`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSeek(a.t);
                      }}
                      className="absolute bottom-0 -translate-x-1/2 px-1"
                      style={{ left: pct(a.t, total) }}
                    >
                      <span className="block h-3 w-px bg-accent" />
                    </button>
                  ))}
              </div>
            </div>
          )}
          {music && musicStale && (
            <p className="pl-16 text-[11px] text-warning sm:pl-20">This beat map is from an earlier version of the edit — it may not match your latest changes.</p>
          )}

          {/* video track */}
          <div className="flex gap-2">
            <div className={LABEL}>Video</div>
            <div ref={trackRef} className={`${ROW} flex-1`} role="listbox" aria-label="Video track" onClick={(e) => e.target === e.currentTarget && onSeek(0)}>
              {music &&
                cuts.map((c) => {
                  const off = nearestOffset(c, snap);
                  const ok = off <= CUT_TOLERANCE;
                  return (
                    <span
                      key={`cut${c}`}
                      aria-label={ok ? `Cut at ${c.toFixed(2)}s is on the beat` : `Cut at ${c.toFixed(2)}s is ${Math.round(off * 1000)}ms off the beat`}
                      title={ok ? `On the beat (${Math.round(off * 1000)}ms)` : `${Math.round(off * 1000)}ms off the nearest beat/accent`}
                      className={`pointer-events-none absolute -top-4 z-20 -translate-x-1/2 text-[10px] leading-none ${ok ? "text-success" : "text-warning"}`}
                      style={{ left: pct(c, total) }}
                    >
                      {ok ? "✓" : "⚠"}
                    </span>
                  );
                })}
              {tl.segments.map((s, i) => {
                const selected = s.id === selectedId;
                const thumb = thumbs[s.clipId];
                const length = s.timelineEnd - s.timelineStart;
                const shownLength = drag?.id === s.id ? drag.previewLength : length;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    aria-label={`Shot ${i + 1}: ${s.video}, ${length.toFixed(1)} seconds`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(selected ? null : s.id);
                    }}
                    title={`${s.video} · ${length.toFixed(2)}s · ${s.speed}x`}
                    className={`absolute top-0 h-full overflow-hidden rounded-md border text-left text-[10px] leading-tight transition-shadow ${
                      selected ? "z-10 border-white ring-2 ring-accent" : "border-black/40 hover:brightness-125"
                    } ${drag?.id === s.id ? "z-20" : ""}`}
                    style={{
                      left: pct(s.timelineStart, total),
                      width: pct(shownLength, total),
                      minWidth: 6,
                      backgroundColor: `hsl(${hue(s.clipId)} 45% 32%)`,
                      backgroundImage: thumb ? `linear-gradient(90deg, rgba(0,0,0,.55), rgba(0,0,0,.15)), url(${thumb})` : undefined,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }}
                  >
                    <span className="block truncate px-1 pt-0.5 font-medium text-white">{i + 1}</span>
                    {s.speed !== 1 && <span className="block truncate px-1 text-white/80">{s.speed}x</span>}
                    {editable && (
                      <span
                        role="slider"
                        aria-label={`Trim ${s.video}`}
                        aria-valuenow={Math.round(shownLength * 10) / 10}
                        tabIndex={-1}
                        onPointerDown={(e) => startTrim(e, s.id, length)}
                        onMouseDown={(e) => startTrim(e, s.id, length)}
                        className="absolute inset-y-0 -right-1.5 z-30 w-4 cursor-col-resize touch-none bg-white/0 hover:bg-white/40 active:bg-white/60"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* effects + transitions */}
          <div className="flex gap-2">
            <div className={LABEL}>Effects</div>
            <div className={`${ROW} h-8 flex-1`}>
              {tl.segments.map((s) => (
                <div key={s.id}>
                  {s.effect !== "none" && (
                    <span
                      className="absolute top-1 truncate rounded bg-accent/25 px-1 text-[10px] text-accent"
                      style={{ left: pct(s.timelineStart, total), maxWidth: pct(s.timelineEnd - s.timelineStart, total) }}
                    >
                      {s.effect.replaceAll("_", " ")}
                    </span>
                  )}
                  {s.transitionIn.type !== "cut" && (
                    <span
                      className="absolute bottom-0.5 -translate-x-1/2 rounded bg-warning/25 px-1 text-[9px] text-warning"
                      style={{ left: pct(s.timelineStart, total) }}
                      title={`${s.transitionIn.type} ${s.transitionIn.duration}s`}
                    >
                      {s.transitionIn.type.replaceAll("_", " ")}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* music */}
          <div className="flex gap-2">
            <div className={LABEL}>Music</div>
            <div className={`${ROW} h-8 flex-1`} onClick={seekFromClick}>
              <div
                className="absolute inset-y-1 left-0 right-0 flex items-center overflow-hidden rounded bg-success/20 px-2 text-[11px] text-success"
                style={{ opacity: 0.4 + Math.min(tl.musicVolume, 1) * 0.6 }}
              >
                <span className="truncate">
                  ♪ {musicName ?? "music"} · starts at {tl.audioStart.toFixed(1)}s in the song · volume {Math.round(tl.musicVolume * 100)}%
                  {tl.bpm ? ` · ${Math.round(tl.bpm)} BPM` : ""}
                </span>
              </div>
            </div>
            {editable && (
              <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Move music">
                <button
                  type="button"
                  aria-label="Start the song 0.5s earlier"
                  disabled={busy || tl.audioStart <= 0}
                  onClick={() => nudgeMusic(-0.5)}
                  className="rounded-lg border border-border px-2 py-1 text-xs hover:border-accent/60 disabled:opacity-40"
                >
                  ♪ ◀
                </button>
                <button
                  type="button"
                  aria-label="Start the song 0.5s later"
                  disabled={busy}
                  onClick={() => nudgeMusic(0.5)}
                  className="rounded-lg border border-border px-2 py-1 text-xs hover:border-accent/60"
                >
                  ♪ ▶
                </button>
              </div>
            )}
          </div>

          {/* voice-over */}
          {tl.voice && (
            <div className="flex gap-2">
              <div className={LABEL}>Voice</div>
              <div className={`${ROW} h-8 flex-1`} onClick={seekFromClick} aria-label="Voice track">
                {tl.voice.lines.map((l, i) => (
                  <span
                    key={i}
                    className="absolute top-1 h-6 truncate rounded bg-fuchsia-400/25 px-1 text-[10px] leading-6 text-fuchsia-200"
                    style={{ left: pct(l.start, total), width: pct(l.end - l.start, total), minWidth: 6 }}
                    title={l.text}
                  >
                    {l.text}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* text */}
          <div className="flex gap-2">
            <div className={LABEL}>Text</div>
            <div className={`${ROW} h-8 flex-1`} onClick={seekFromClick}>
              {tl.captions.map((c) => (
                <span
                  key={c.id}
                  className="absolute top-1 h-6 truncate rounded bg-blue-400/25 px-1 text-[10px] leading-6 text-blue-200"
                  style={{ left: pct(c.start, total), width: pct(c.end - c.start, total), minWidth: 6 }}
                  title={c.text}
                >
                  {c.text}
                </span>
              ))}
              {tl.captions.length === 0 && <span className="px-2 text-[11px] leading-8 text-muted">no captions</span>}
            </div>
          </div>

          {/* playhead */}
          <div className="pointer-events-none absolute inset-y-0 left-16 right-0 sm:left-20" aria-hidden>
            <div className="relative ml-2 h-full">
              <div
                data-testid="playhead"
                className="absolute inset-y-0 w-px bg-white/90"
                style={{ left: pct(playhead, total) }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
