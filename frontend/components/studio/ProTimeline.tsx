"use client";

import { useEffect, useRef, useState } from "react";
import type { EdlTimeline } from "@/types/api";
import { op } from "@/lib/ops";
import { pretty } from "@/lib/editorFx";

const HEAD = 76; // px: the track header column
const MIN_LEN = 0.25;

type Drag =
  | { kind: "trim"; id: string; x0: number; len0: number; len: number }
  | { kind: "move"; id: string; x0: number; dx: number }
  | { kind: "playhead" }
  | null;

/** A professional timeline (Filmora / Premiere style): a time ruler, track headers (Text, Video, Music), clips drawn as
 * filmstrips of their picture, transition markers between clips, a playhead you can drag, and a zoom slider. Click a
 * clip to select it, drag it to reorder, drag its right edge to trim; every change goes to the server as one edit. */
export function ProTimeline({ tl, selectedId, onSelect, playhead, onSeek, thumbs, musicName, busy, onEdit, onTransitionClick }: {
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
  const area = useRef<HTMLDivElement>(null);
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
    return Math.min(Math.max((clientX - r.left + (area.current?.scrollLeft ?? 0) - HEAD) / pps, 0), tl.duration);
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      if (drag.kind === "playhead") onSeek(timeAt(e.clientX));
      else if (drag.kind === "trim") setDrag({ ...drag, len: Math.max(drag.len0 + (e.clientX - drag.x0) / pps, MIN_LEN) });
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
      setPps((v) => Math.min(Math.max(v * Math.exp(-e.deltaY * 0.01), 10), 240));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // keep the playhead in view while playing
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const px = HEAD + x(playhead);
    if (px < el.scrollLeft + HEAD || px > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = Math.max(px - el.clientWidth / 3, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playhead, pps]);

  const beats = tl.bpm > 0 ? Array.from({ length: Math.floor((tl.duration * tl.bpm) / 60) + 1 }, (_, i) => (i * 60) / tl.bpm) : [];

  return (
    <div className="select-none">
      <div className="mb-1 flex items-center justify-end gap-2 px-1 text-[10px] text-muted">
        <span>Zoom</span>
        <button type="button" className="px-1 hover:text-foreground" onClick={() => setPps((v) => Math.max(v / 1.4, 10))} aria-label="Zoom out">
          −
        </button>
        <input type="range" min={10} max={240} value={pps} onChange={(e) => setPps(Number(e.target.value))} aria-label="Timeline zoom" className="w-28 accent-[var(--accent)]" />
        <button type="button" className="px-1 hover:text-foreground" onClick={() => setPps((v) => Math.min(v * 1.4, 240))} aria-label="Zoom in">
          +
        </button>
      </div>
      <div
        ref={area}
        className="relative overflow-x-auto overflow-y-hidden rounded-lg border border-border bg-background"
      >
        <div className="relative" style={{ width: width + HEAD }}>
          {/* ruler */}
          <div
            className="sticky top-0 z-10 flex h-6 border-b border-border bg-surface"
            onPointerDown={(e) => {
              onSeek(timeAt(e.clientX));
              setDrag({ kind: "playhead" });
            }}
          >
            <div className="sticky left-0 z-20 shrink-0 border-r border-border bg-surface" style={{ width: HEAD }} />
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
              ["T1", "Text", "h-6 [@media(min-height:760px)]:h-8"],
              ["V1", "Video", "h-12 [@media(min-height:760px)]:h-16"],
              ["A1", "Music", "h-7 [@media(min-height:760px)]:h-10"],
            ] as const
          ).map(([code, name, h]) => (
            <div key={code} className={`flex border-b border-border ${h}`}>
              <div className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-border bg-surface px-2 text-[10px] text-muted" style={{ width: HEAD }}>
                <span className="rounded bg-surface-2 px-1 font-mono text-[9px] text-foreground">{code}</span>
                {name}
              </div>
              <div className="relative flex-1" onPointerDown={(e) => e.target === e.currentTarget && onSelect(null)}>
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
                    {beats.map((b, k) => (
                      <span key={k} className={`absolute inset-y-0 w-px ${k % 4 === 0 ? "bg-emerald-200/60" : "bg-emerald-200/25"}`} style={{ left: x(b) }} />
                    ))}
                    <span className="absolute left-1 top-0.5 truncate text-[9px] text-emerald-50">♪ {musicName ?? "No music"}{tl.bpm ? ` · ${Math.round(tl.bpm)} BPM` : ""}</span>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* playhead */}
          <div className="pointer-events-none absolute bottom-0 top-0 z-30 w-px bg-accent" style={{ left: HEAD + x(playhead) }}>
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
