"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BeatEvent, BeatMap as BeatMapData, PlanRow } from "@/types/api";

/** m:ss.cc, precise enough to find a beat by ear. */
export function beatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

const KIND_LABEL: Record<BeatEvent["kind"], string> = { major: "Major beat", beat: "Beat", sub: "Sub-beat" };
const KIND_STYLE: Record<BeatEvent["kind"], string> = {
  major: "bg-accent/20 text-accent border-accent/50",
  beat: "bg-surface text-foreground border-border",
  sub: "bg-surface/60 text-muted border-border",
};
const SECTION_FILL: Record<string, string> = {
  intro: "#64748b", build: "#f59e0b", drop: "#ef4444", chorus: "#d4b07a", verse: "#6366f1", bridge: "#14b8a6", outro: "#64748b",
};

type Filter = "plan" | "all" | "major" | "beat" | "sub" | "drops" | "trends";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "plan", label: "Cut plan" },
  { id: "all", label: "Everything" },
  { id: "major", label: "Major beats" },
  { id: "beat", label: "Beats" },
  { id: "sub", label: "Sub-beats" },
  { id: "drops", label: "Drops" },
  { id: "trends", label: "Build-ups & breakdowns" },
];
const PAGE = 150;

/**
 * The song, beat by beat: a playable map (parts, energy and rhythm curves, build-ups and breakdowns, every major beat,
 * beat, sub-beat and drop) and the list of moments with their exact time and the video effect each one gets.
 */
export function BeatMap({ data, src }: { data: BeatMapData; src: string }) {
  const [zoom, setZoom] = useState(24); // pixels per second
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [filter, setFilter] = useState<Filter>("plan");
  const [shown, setShown] = useState(PAGE);
  const audio = useRef<HTMLAudioElement | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [clicks, setClicks] = useState(false); // a tick on every beat while playing: hear whether the beats are right
  const clicksOn = useRef(false);
  useEffect(() => {
    clicksOn.current = clicks; // the playback loop reads it without restarting
  }, [clicks]);
  const ctx = useRef<AudioContext | null>(null);
  const lastT = useRef(0);
  const beats = useMemo(() => data.events.filter((e) => e.kind !== "sub"), [data]);

  /** A short tick: high on a bar start, medium on a strong beat, soft on the other beats. */
  function tickSound(e: BeatEvent) {
    const ac = ctx.current;
    if (!ac) return;
    const bar = e.downbeat;
    const strong = !bar && (e.kind === "major" || (e.level ?? 1) >= 3);
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.frequency.value = bar ? 1760 : strong ? 1180 : 760;
    gain.gain.setValueAtTime(bar ? 0.5 : strong ? 0.35 : 0.18, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.05);
    osc.connect(gain).connect(ac.destination);
    osc.start();
    osc.stop(ac.currentTime + 0.06);
  }

  useEffect(() => {
    const el = new Audio(src);
    let raf = 0;
    const tick = () => {
      const t = el.currentTime;
      if (clicksOn.current && t >= lastT.current && t - lastT.current < 0.5) {
        for (const e of beats) if (e.t > lastT.current && e.t <= t) tickSound(e);
      }
      lastT.current = t;
      setNow(t);
      raf = requestAnimationFrame(tick);
    };
    el.onplay = () => {
      setPlaying(true);
      raf = requestAnimationFrame(tick);
    };
    el.onpause = () => {
      setPlaying(false);
      cancelAnimationFrame(raf);
    };
    audio.current = el;
    return () => {
      cancelAnimationFrame(raf);
      el.pause();
    };
  }, [src, beats]);

  // keep the playhead in view while playing
  useEffect(() => {
    const sc = scroller.current;
    if (!sc || !playing) return;
    const x = now * zoom;
    if (x < sc.scrollLeft + 40 || x > sc.scrollLeft + sc.clientWidth - 80) sc.scrollLeft = Math.max(x - 80, 0);
  }, [now, zoom, playing]);

  function seek(t: number, play = true) {
    const el = audio.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(t, data.seconds - 0.05));
    setNow(el.currentTime);
    if (play) void el.play();
  }

  const W = Math.max(data.seconds * zoom, 300);
  const H = 150;
  const curveTop = 26;
  const curveH = 70;
  const tickTop = curveTop + curveH + 6;

  const path = (values: number[]) =>
    values.map((v, i) => `${i ? "L" : "M"}${(i * data.curveStep * zoom).toFixed(1)},${(curveTop + curveH * (1 - Math.min(v, 1))).toFixed(1)}`).join("");
  const energyPath = useMemo(() => path(data.energy), [data, zoom]); // eslint-disable-line react-hooks/exhaustive-deps
  const rhythmPath = useMemo(() => path(data.rhythm), [data, zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    type Row = { t: number; end?: number; badge: string; badgeStyle: string; strength: number; section: string; effect: string; why: string };
    const fromEvent = (e: BeatEvent): Row => ({
      t: e.t, badge: e.effect === "crash_zoom" ? "Drop" : KIND_LABEL[e.kind], strength: e.strength, section: e.section,
      effect: e.effectLabel, why: e.why, badgeStyle: e.effect === "crash_zoom" ? "bg-red-500/20 text-red-400 border-red-500/50" : KIND_STYLE[e.kind],
    });
    const trends: Row[] = data.trends.map((tr) => ({
      t: tr.start, end: tr.end, badge: tr.kind === "rise" ? "Build-up ↗" : "Breakdown ↘", strength: Math.abs(tr.change), section: "",
      effect: tr.effectLabel, why: tr.why,
      badgeStyle: tr.kind === "rise" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40" : "bg-sky-500/15 text-sky-400 border-sky-500/40",
    }));
    const rolls: Row[] = data.rolls.map((r) => ({
      t: r.start, end: r.end, badge: "Fast hits", strength: Math.min(r.perSecond / 8, 1), section: "",
      effect: `${r.count} small hits (${r.perSecond}/s)`, why: "hi-hats or a roll: keep the shot moving", badgeStyle: "bg-violet-500/15 text-violet-300 border-violet-500/40",
    }));
    let list: Row[];
    if (filter === "trends") list = trends;
    else if (filter === "sub") list = [...data.events.filter((e) => e.kind === "sub").map(fromEvent), ...rolls].sort((a, b) => a.t - b.t);
    else if (filter === "drops") list = data.events.filter((e) => e.effect === "crash_zoom").map(fromEvent);
    else if (filter === "all") list = [...data.events.map(fromEvent), ...trends, ...rolls].sort((a, b) => a.t - b.t);
    else list = data.events.filter((e) => e.kind === filter).map(fromEvent);
    return list;
  }, [data, filter]);

  const c = data.counts;
  const chips: [string, number | string][] = [
    ["BPM", data.bpm], ["s between beats", data.beatSeconds.toFixed(2)], ["major beats", c.major], ["beats", c.beat],
    ["sub-beats", c.sub], ["hard hits (flash)", c.hardSub], ["drops", c.drops], ["build-ups", c.rises], ["breakdowns", c.falls], ["cuts in the plan", c.cuts],
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {chips.map(([label, v]) => (
          <span key={label} className="rounded-full border border-border bg-surface/70 px-3 py-1 text-xs">
            <span className="font-semibold text-foreground">{v}</span> <span className="text-muted">{label}</span>
          </span>
        ))}
        {Math.abs(data.trackerBpm - data.bpm * 2) < 3 && (
          <span className="rounded-full border border-border bg-surface/70 px-3 py-1 text-xs text-muted">
            counted in double time: {data.trackerBpm} BPM (a beat every {(data.beatSeconds / 2).toFixed(2)} s)
          </span>
        )}
        {data.downbeatConfidence !== undefined && (
          <span className={`rounded-full border px-3 py-1 text-xs ${data.downbeatConfidence >= 0.5 ? "border-border bg-surface/70 text-muted" : "border-amber-500/40 bg-amber-500/10 text-amber-400"}`}>
            bar starts {data.downbeatConfidence >= 0.5 ? "found" : "uncertain"} ({Math.round(data.downbeatConfidence * 100)}% sure)
          </span>
        )}
        {data.beatConfidence < 0.4 && (
          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs text-amber-400">
            The beat is irregular in this song: cuts follow its hits and phrases more than a strict grid
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="lux-btn-gold rounded-full px-4 py-1.5 text-sm font-semibold" onClick={() => (playing ? audio.current?.pause() : seek(now))}>
          {playing ? "❚❚ Pause" : "▶ Play"}
        </button>
        <span className="font-mono text-sm tabular-nums">{beatTime(now)}</span>
        <button type="button" aria-pressed={clicks}
          className={`rounded-full border px-3 py-1 text-xs ${clicks ? "border-accent bg-accent/15 text-accent" : "border-border text-muted hover:text-foreground"}`}
          onClick={() => {
            if (!ctx.current) ctx.current = new AudioContext();
            void ctx.current.resume();
            setClicks((c) => !c);
          }}>
          ♪ Click track {clicks ? "on" : "off"}
        </button>
        <label className="ml-auto flex items-center gap-2 text-xs text-muted">
          Zoom
          <input type="range" min={8} max={120} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom the beat map" />
        </label>
      </div>

      <div ref={scroller} className="overflow-x-auto rounded-2xl border border-border bg-black/30" style={{ overscrollBehaviorX: "contain" }}>
        <svg
          width={W}
          height={H}
          role="img"
          aria-label="Beat map: parts, energy, rhythm, beats and drops of the song"
          className="block cursor-pointer select-none"
          onClick={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            seek((e.clientX - r.left) / zoom);
          }}
        >
          {data.sections.map((s, i) => (
            <g key={i}>
              <rect x={s.start * zoom} y={0} width={Math.max((s.end - s.start) * zoom, 1)} height={H} fill={SECTION_FILL[s.label] ?? "#64748b"} opacity={0.06 + s.energy * 0.12} />
              <text x={s.start * zoom + 4} y={14} fontSize={10} fill={SECTION_FILL[s.label] ?? "#94a3b8"} fontWeight={600}>
                {s.label.toUpperCase()}
              </text>
            </g>
          ))}
          {data.trends.map((tr, i) => (
            <rect key={i} x={tr.start * zoom} y={curveTop} width={(tr.end - tr.start) * zoom} height={curveH}
              fill={tr.kind === "rise" ? "#10b981" : "#0ea5e9"} opacity={0.14} />
          ))}
          <path d={energyPath} fill="none" stroke="#d4b07a" strokeWidth={1.6} />
          <path d={rhythmPath} fill="none" stroke="#a78bfa" strokeWidth={1} opacity={0.8} />
          {data.events.map((e, i) => {
            const x = e.t * zoom;
            if (e.effect === "crash_zoom")
              return <path key={i} d={`M${x},${tickTop - 4} l5,8 l-5,8 l-5,-8z`} fill="#ef4444"><title>{`Drop ${beatTime(e.t)}`}</title></path>;
            if (e.kind === "major") return <line key={i} x1={x} x2={x} y1={tickTop} y2={H - 4} stroke="#d4b07a" strokeWidth={2} />;
            if (e.kind === "beat") return <line key={i} x1={x} x2={x} y1={tickTop + 14} y2={H - 4} stroke="#e5e7eb" strokeWidth={1} opacity={0.7} />;
            return zoom >= 16 ? <line key={i} x1={x} x2={x} y1={tickTop + 30} y2={H - 4} stroke="#94a3b8" strokeWidth={1} opacity={0.5} /> : null;
          })}
          {beats.map((e, i) => {
            // markers like an editor's beat dots: big = bar start, medium = strong beat, small = beat
            const bar = e.downbeat;
            const strong = !bar && (e.kind === "major" || (e.level ?? 1) >= 3);
            return <circle key={`m${i}`} cx={e.t * zoom} cy={curveTop - 6} r={bar ? 4 : strong ? 3 : 1.6}
              fill={bar ? "#facc15" : strong ? "#d4b07a" : "#9ca3af"} opacity={bar || strong ? 1 : 0.6}><title>{`${bar ? "Bar start" : strong ? "Strong beat" : "Beat"} ${beatTime(e.t)}`}</title></circle>;
          })}
          <line x1={now * zoom} x2={now * zoom} y1={0} y2={H} stroke="#fff" strokeWidth={1.5} />
        </svg>
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span><span className="text-yellow-400">●</span> bar start</span>
        <span><span className="text-accent">•</span> strong beat</span>
        <span><span className="text-accent">━</span> energy</span>
        <span><span className="text-violet-400">━</span> rhythm</span>
        <span><span className="text-accent">┃</span> major beat</span>
        <span>│ beat</span>
        <span className="opacity-70">╎ sub-beat</span>
        <span><span className="text-red-500">◆</span> drop</span>
        <span><span className="text-emerald-400">▇</span> build-up</span>
        <span><span className="text-sky-400">▇</span> breakdown</span>
        <span>Click anywhere to listen from there.</span>
      </p>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Which moments to list">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={filter === f.id}
            className={`rounded-full border px-3 py-1 text-xs ${filter === f.id ? "border-accent bg-accent/15 text-accent" : "border-border text-muted hover:text-foreground"}`}
            onClick={() => { setFilter(f.id); setShown(PAGE); }}>
            {f.label}
          </button>
        ))}
      </div>
      {filter === "plan" ? (
        <PlanTable rows={data.plan} now={now} onSeek={seek} />
      ) : (
      <div className="overflow-hidden rounded-2xl border border-border">
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-surface text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Moment</th>
                <th className="hidden px-3 py-2 font-medium sm:table-cell">Strength</th>
                <th className="hidden px-3 py-2 font-medium md:table-cell">Part</th>
                <th className="px-3 py-2 font-medium">Video effect</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, shown).map((r, i) => {
                const current = now >= r.t && now < (r.end ?? r.t + data.beatSeconds / 2);
                return (
                  <tr key={i} className={`cursor-pointer border-t border-border/60 hover:bg-surface/60 ${current ? "bg-accent/10" : ""}`} onClick={() => seek(r.t)}>
                    <td className="px-3 py-1.5 font-mono tabular-nums">{beatTime(r.t)}{r.end ? ` – ${beatTime(r.end)}` : ""}</td>
                    <td className="px-3 py-1.5"><span className={`rounded-full border px-2 py-0.5 ${r.badgeStyle}`}>{r.badge}</span></td>
                    <td className="hidden px-3 py-1.5 sm:table-cell">
                      <span className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-border align-middle">
                        <span className="block h-full bg-accent" style={{ width: `${Math.round(Math.min(r.strength, 1) * 100)}%` }} />
                      </span>
                    </td>
                    <td className="hidden px-3 py-1.5 capitalize text-muted md:table-cell">{r.section}</td>
                    <td className="px-3 py-1.5"><span className="font-medium">{r.effect}</span> <span className="hidden text-muted lg:inline">· {r.why}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length > shown && (
            <button type="button" className="w-full border-t border-border py-2 text-xs text-muted hover:text-foreground" onClick={() => setShown((n) => n + PAGE)}>
              Show more ({rows.length - shown} left)
            </button>
          )}
        </div>
      </div>
      )}
    </div>
  );
}

const TRANSITION_LABEL: Record<string, string> = { fade_in: "Fade in", flash: "Flash cut", cut: "Cut", "": "" };

/** The edit, shot by shot: when each cut lands, what shot to put there, its effect and its way in. */
/** The plan with every beat on a row of its own: a beat a shot holds over (it pulses on it) is listed too, not only
 * counted in the shot's effect. */
function everyBeat(plan: PlanRow[]): PlanRow[] {
  const listed = plan.map((r) => r.t);
  const beats: PlanRow[] = plan.flatMap((r) => (r.kind === "cut" ? r.pulses ?? [] : [])
    .filter((p) => !listed.some((t) => Math.abs(t - p) <= 0.06))
    .map((p) => ({ t: p, end: p, kind: "hit" as const, shot: "♪ Beat: pulse (same shot)", effect: "zoom_pulse", effectLabel: "Soft pulse",
      transition: "", why: "a beat inside the shot" })));
  return [...plan, ...beats].sort((a, b) => a.t - b.t);
}

export function PlanTable({ rows: plan, now, onSeek, offset = 0 }: { rows: PlanRow[]; now?: number; onSeek?: (t: number) => void; offset?: number }) {
  const rows = useMemo(() => everyBeat(plan), [plan]);
  const numbers = rows.map((_, i) => rows.slice(0, i + 1).filter((r) => r.kind === "cut").length); // shot number of each row
  return (
    <div className="overflow-hidden rounded-2xl border border-border">
      <div className="max-h-96 overflow-y-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-surface text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Time</th>
              <th className="px-3 py-2 font-medium">Shot</th>
              <th className="px-3 py-2 font-medium">Effect</th>
              <th className="hidden px-3 py-2 font-medium sm:table-cell">In</th>
              <th className="px-3 py-2 font-medium">Motion</th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">Why</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const cut = r.kind === "cut";
              const current = now !== undefined && now >= r.t && now < (cut ? r.end : r.t + 0.15);
              const big = r.transition === "flash" || r.effect === "crash_zoom";
              return (
                <tr key={i} className={`border-t border-border/60 ${onSeek ? "cursor-pointer hover:bg-surface/60" : ""} ${current ? "bg-accent/10" : ""} ${cut ? "" : "text-muted"}`}
                  onClick={() => onSeek?.(r.t)}>
                  <td className="px-3 py-1.5 tabular-nums">{cut ? numbers[i] : "↯"}</td>
                  <td className="px-3 py-1.5 font-mono tabular-nums">{beatTime(r.t - offset)}{big ? " 🔥" : ""}</td>
                  <td className="px-3 py-1.5">{r.shot}</td>
                  <td className="px-3 py-1.5 font-medium">{r.effectLabel}</td>
                  <td className="hidden px-3 py-1.5 sm:table-cell">{r.transitionLabel ?? TRANSITION_LABEL[r.transition] ?? r.transition}{r.tdur && r.kind === "cut" && r.transition !== "fade_in" ? ` · lands on the beat` : ""}</td>
                  <td className="px-3 py-1.5">
                    {r.motion?.length ? (
                      <span className="flex flex-wrap gap-1">
                        {r.motion.map((m, j) => (
                          <span key={j} className={`rounded px-1.5 py-0.5 text-[10px] ${m.startsWith("Ramp") || m.startsWith("Fast") || m.startsWith("Slow motion") ? "bg-accent/20 text-accent" : "bg-surface text-muted"}`}>
                            {m.startsWith("Ramp") || m.startsWith("Fast") || m.startsWith("Slow motion") ? "⚡ " : ""}{m}
                          </span>
                        ))}
                      </span>
                    ) : <span className="text-muted">-</span>}
                  </td>
                  <td className="hidden px-3 py-1.5 text-muted md:table-cell">{r.why}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
