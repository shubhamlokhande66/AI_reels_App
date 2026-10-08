"use client";

import { useEffect, useRef } from "react";
import type { EdlTimeline } from "@/types/api";
import { LOOK_CSS, effectStyle, transitionStyle } from "@/lib/editorFx";

interface Props {
  timeline: EdlTimeline;
  clipUrls: Record<string, string>;
  musicUrl?: string | null;
  playhead: number;
  onTime: (t: number) => void;
  playing: boolean;
  onPlaying: (p: boolean) => void;
}

const SIZE = { small: "text-[5.5cqw]", medium: "text-[7.5cqw]", large: "text-[10cqw]" } as const;
const POS = { top: "top-[14%]", center: "top-1/2 -translate-y-1/2", bottom: "bottom-[18%]" } as const;

/** Plays the edit in the browser at once: every clip is preloaded once, the right one is shown and kept in sync with
 * the clock and the song; effects, looks and transitions are close approximations (Export HD renders them exactly). */
export function LivePlayer({ timeline, clipUrls, musicUrl, playhead, onTime, playing, onPlaying }: Props) {
  const videos = useRef<Record<string, HTMLVideoElement | null>>({});
  const layers = useRef<Record<string, HTMLDivElement | null>>({});
  const audio = useRef<HTMLAudioElement>(null);
  const clock = useRef({ t: playhead, at: 0 });
  const raf = useRef<number | null>(null);
  const tl = timeline;
  const look = LOOK_CSS[tl.colorGrade ?? ""] ?? "";
  const clipIds = [...new Set(tl.segments.map((s) => s.clipId))];

  // draw the frame for time t: which clips are visible, at which point, with which effect / transition
  function draw(t: number, play: boolean) {
    const segs = tl.segments;
    const i = Math.max(0, segs.findIndex((s) => t >= s.timelineStart && t < s.timelineEnd));
    const cur = segs[i];
    const next = segs[i + 1];
    const visible = new Map<string, { opacity: number; clip?: string; transform: string; filter: string; z: number }>();
    if (cur) {
      const local = t - cur.timelineStart;
      const fx = effectStyle(cur.effect, local / Math.max(cur.timelineEnd - cur.timelineStart, 0.01), local);
      visible.set(cur.id, { opacity: 1, transform: fx.transform, filter: fx.filter, z: 1 });
      // the incoming transition of the next shot overlaps the end of this one (half before the cut)
      const tr = next?.transitionIn;
      if (next && tr && tr.type !== "cut" && tr.duration > 0) {
        const into = t - (next.timelineStart - tr.duration / 2);
        if (into > 0) {
          const st = transitionStyle(tr.type, into / tr.duration);
          const nfx = effectStyle(next.effect, 0, 0);
          visible.set(next.id, { opacity: st.opacity, clip: st.clipPath, transform: `${st.transform ?? ""} ${nfx.transform}`, filter: `${st.filter ?? ""} ${nfx.filter}`, z: 2 });
        }
      }
      // ... and the start of this one
      const tin = cur.transitionIn;
      if (i > 0 && tin.type !== "cut" && tin.duration > 0 && local < tin.duration / 2) {
        const st = transitionStyle(tin.type, (local + tin.duration / 2) / tin.duration);
        visible.set(cur.id, { opacity: st.opacity, clip: st.clipPath, transform: `${st.transform ?? ""} ${fx.transform}`, filter: `${st.filter ?? ""} ${fx.filter}`, z: 2 });
        const prev = segs[i - 1];
        const pfx = effectStyle(prev.effect, 1, prev.timelineEnd - prev.timelineStart);
        visible.set(prev.id, { opacity: 1, transform: pfx.transform, filter: pfx.filter, z: 1 });
      }
    }
    // one picture layer per clip (not per shot): shots of the same clip share it, so a Reel of 40 shots from 10 clips loads 10 videos
    const byClip = new Map<string, { s: (typeof segs)[number]; vis: NonNullable<ReturnType<typeof visible.get>> }>();
    for (const s of segs) {
      const vis = visible.get(s.id);
      const had = byClip.get(s.clipId);
      if (vis && (!had || vis.z > had.vis.z)) byClip.set(s.clipId, { s, vis });
    }
    for (const clipId of clipIds) {
      const layer = layers.current[clipId];
      const v = videos.current[clipId];
      const hit = byClip.get(clipId);
      if (!layer || !v) continue;
      if (!hit) {
        layer.style.opacity = "0";
        if (!v.paused) v.pause();
        continue;
      }
      const { s, vis } = hit;
      layer.style.opacity = String(vis.opacity);
      layer.style.zIndex = String(vis.z);
      layer.style.clipPath = vis.clip ?? "none";
      v.style.transform = vis.transform;
      v.style.filter = `${look} ${vis.filter}`;
      const local = Math.min(Math.max(t - s.timelineStart, 0), s.timelineEnd - s.timelineStart);
      const want = s.effect === "freeze" ? s.sourceStart : s.sourceStart + local * s.speed;
      if (Math.abs(v.currentTime - want) > (play ? 0.25 : 0.04)) v.currentTime = want;
      v.playbackRate = Math.min(Math.max(s.speed, 0.25), 4);
      if (play && s.effect !== "freeze" && v.paused) void v.play().catch(() => {});
      if (!play && !v.paused) v.pause();
    }
    const a = audio.current;
    if (a) {
      const want = tl.audioStart + t;
      if (Math.abs(a.currentTime - want) > (play ? 0.2 : 0.05)) a.currentTime = want;
      a.volume = Math.min(Math.max(tl.musicVolume, 0), 1);
      if (play && a.paused) void a.play().catch(() => {});
      if (!play && !a.paused) a.pause();
    }
  }

  // follow the playhead when it is moved by hand (paused)
  useEffect(() => {
    if (!playing) {
      clock.current = { t: playhead, at: performance.now() };
      draw(playhead, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playhead, playing, timeline]);

  // the clock while playing
  useEffect(() => {
    if (!playing) return;
    clock.current = { t: playhead >= tl.duration - 0.05 ? 0 : playhead, at: performance.now() };
    const tick = () => {
      const t = clock.current.t + (performance.now() - clock.current.at) / 1000;
      if (t >= tl.duration) {
        onTime(tl.duration);
        onPlaying(false);
        draw(tl.duration - 0.01, false);
        return;
      }
      draw(t, true);
      onTime(t);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      draw(clock.current.t + (performance.now() - clock.current.at) / 1000, false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const overlays = (tl.overlays ?? []).filter((o) => playhead >= o.start && playhead <= o.end);
  const caption = tl.captions.find((c) => playhead >= c.start && playhead <= c.end);

  return (
    <div className="relative mx-auto aspect-[9/16] w-full max-w-[min(360px,calc(62svh*9/16))] overflow-hidden rounded-2xl bg-black shadow-2xl [container-type:inline-size]">
      {clipIds.map((cid) => {
        const fit = tl.segments.find((s) => s.clipId === cid)?.crop.framing === "fit";
        return (
          <div key={cid} ref={(el) => void (layers.current[cid] = el)} className="absolute inset-0 overflow-hidden" style={{ opacity: 0 }}>
            <video
              ref={(el) => void (videos.current[cid] = el)}
              src={clipUrls[cid]}
              muted
              playsInline
              preload="metadata"
              onLoadedData={() => {
                if (!playing) draw(clock.current.t, false); // the first frame once the clip has loaded (not a black box)
              }}
              className={`h-full w-full ${fit ? "object-contain" : "object-cover"}`}
              style={{ transformOrigin: "50% 50%" }}
            />
          </div>
        );
      })}
      {musicUrl && <audio ref={audio} src={musicUrl} preload="auto" />}
      {overlays.map((o, k) => (
        <p
          key={o.id ?? k}
          className={`pointer-events-none absolute inset-x-[8%] z-10 text-center font-bold leading-tight text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.8)] ${SIZE[o.size]} ${POS[o.position]}`}
        >
          {o.text}
        </p>
      ))}
      {caption && (
        <p className="pointer-events-none absolute inset-x-[8%] bottom-[10%] z-10 text-center text-[5.5cqw] font-semibold text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
          {caption.text}
        </p>
      )}
      {tl.segments.length === 0 && <p className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white/70">Add clips from the media bin</p>}
    </div>
  );
}
