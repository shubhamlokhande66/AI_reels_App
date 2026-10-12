"use client";

import { useEffect, useRef } from "react";
import type { EdlTimeline, PreviewHints } from "@/types/api";
import { LOOK_CSS, correctionCss, effectStyle, flashAmount, flashThrough, keyframeStyle, lookCss, rampAt, shotAnimation, transitionStyle } from "@/lib/editorFx";

interface Props {
  timeline: EdlTimeline;
  clipUrls: Record<string, string>;
  musicUrl?: string | null;
  playhead: number;
  onTime: (t: number) => void;
  playing: boolean;
  onPlaying: (p: boolean) => void;
  /** Fill the height it is given (the editor's player area), keeping 9:16, instead of a fixed width. */
  fill?: boolean;
  /** The renderer's framing and correction per shot (backend services/preview_hints.py): without them the preview
   * centres every clip and skips the corrections, so it does not look like the export. */
  hints?: PreviewHints;
}

const STAB_ZOOM = 1.04; // a steadied (shaky) clip is shown slightly enlarged, as the stabiliser does
const BACKDROP = "blur(6px) brightness(0.9) saturate(1.15)"; // fit mode: the dimmed, blurred copy behind the picture

const SIZE = { small: "text-[5.5cqw]", medium: "text-[7.5cqw]", large: "text-[10cqw]" } as const;
const POS = { top: "top-[14%]", center: "top-1/2 -translate-y-1/2", bottom: "bottom-[18%]" } as const;

/** Plays the edit in the browser at once: every clip is preloaded once, the right one is shown and kept in sync with
 * the clock and the song; effects, looks and transitions are close approximations (Export HD renders them exactly). */
export function LivePlayer({ timeline, clipUrls, musicUrl, playhead, onTime, playing, onPlaying, fill = false, hints }: Props) {
  const videos = useRef<Record<string, HTMLVideoElement | null>>({});
  const layers = useRef<Record<string, HTMLDivElement | null>>({});
  const frames = useRef<Record<string, HTMLDivElement | null>>({});
  const backdrops = useRef<Record<string, HTMLCanvasElement | null>>({});
  const white = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const clock = useRef({ t: playhead, at: 0 });
  const raf = useRef<number | null>(null);
  const tl = timeline;
  const look = LOOK_CSS[tl.colorGrade ?? ""] ?? "";
  const clipIds = [...new Set(tl.segments.map((s) => s.clipId))];

  // the song's hits inside a shot, seconds from its start (renderer.py / cutter.plan_segments)
  const hitsFor = (s: (typeof tl.segments)[number]) =>
    musicUrl ? (tl.musicHits ?? []).map((h) => h - tl.audioStart).filter((h) => s.timelineStart + 0.05 < h && h < s.timelineEnd - 0.05).slice(0, 40).map((h) => h - s.timelineStart) : [];

  // a shot's picture at ``local`` seconds: its keyframes over its effect (video/keyframes.py), its looks on top
  function shotStyle(s: (typeof tl.segments)[number], local: number, len: number): { transform: string; filter: string; white: number } {
    const fx = effectStyle(s.effect, local / Math.max(len, 0.01), local, len, hitsFor(s));
    const looks = (s.looks ?? []).map(lookCss).filter(Boolean).join(" ");
    const anim = shotAnimation(s.effect, s.keyframes, len);
    if (!anim.length) return { transform: fx.transform, filter: `${fx.filter} ${looks}`, white: flashAmount(s.effect, local, hitsFor(s)) };
    const k = keyframeStyle(anim, local, layers.current[s.clipId]?.clientWidth ?? 360);
    const keyedFlash = s.effect === "flash"; // the flash is in the keyframes then
    return {
      transform: k.transform ?? fx.transform, // keyframes that move the picture replace the effect's own movement
      filter: `${k.transform ? "" : fx.filter} ${looks} ${k.filter}`,
      white: Math.max(k.white, keyedFlash ? 0 : flashAmount(s.effect, local, hitsFor(s))),
    };
  }

  // draw the frame for time t exactly as the renderer composes it: a shot's transition starts at its first moment and
  // runs for its duration over the previous shot, which plays on underneath (composer.build_video_graph)
  function draw(t: number, play: boolean) {
    const segs = tl.segments;
    const i = Math.max(0, segs.findIndex((s) => t >= s.timelineStart && t < s.timelineEnd));
    const cur = segs[i];
    const visible = new Map<string, { opacity: number; clip?: string; transform: string; filter: string; z: number; local: number }>();
    let flash = 0; // white laid over the picture: a flash effect or a flash transition (the renderer adds light)
    if (cur) {
      const local = t - cur.timelineStart;
      const len = cur.timelineEnd - cur.timelineStart;
      const fx = shotStyle(cur, local, len);
      flash = fx.white;
      visible.set(cur.id, { opacity: 1, transform: fx.transform, filter: fx.filter, z: 1, local });
      const tin = cur.transitionIn;
      if (i > 0 && tin.type !== "cut" && tin.type !== "speed_ramp" && tin.duration > 0 && local < tin.duration) {
        const st = transitionStyle(tin.type, local / tin.duration);
        visible.set(cur.id, { opacity: st.opacity, clip: st.clipPath, transform: `${st.transform ?? ""} ${fx.transform}`, filter: `${st.filter ?? ""} ${fx.filter}`, z: 2, local });
        const prev = segs[i - 1];
        const plen = prev.timelineEnd - prev.timelineStart;
        const plocal = t - prev.timelineStart; // the previous shot runs on past its end (its tail)
        const pfx = shotStyle(prev, plocal, plen);
        if (tin.type === "flash") flash = Math.max(flash, flashThrough(local / tin.duration));
        visible.set(prev.id, { opacity: 1, transform: pfx.transform, filter: pfx.filter, z: 1, local: plocal });
      }
    }
    if (white.current) white.current.style.opacity = String(Math.min(flash, 1));
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
      // framed as the renderer frames it: its own crop of the clip (fill), or the whole picture over a blurred copy (fit)
      const h = hints?.segments[s.id];
      const fit = h ? h.mode === "fit" : s.crop.framing === "fit";
      const frame = frames.current[clipId];
      const back = backdrops.current[clipId];
      const zoom = h?.stabilized ? `scale(${STAB_ZOOM}) ` : "";
      const correction = look || correctionCss(hints?.grade, h?.lift, h?.gamma);
      layer.style.filter = `${correction} ${vis.filter}`;
      if (fit) {
        Object.assign(v.style, { left: "0", top: "0", width: "100%", height: "100%", objectFit: "contain", transform: `${zoom}${vis.transform}` });
        if (frame) frame.style.transform = "none";
        if (back) {
          back.style.display = "block";
          const ctx = back.getContext("2d");
          if (ctx && v.readyState >= 2 && v.videoWidth) {
            const r = Math.max(back.width / v.videoWidth, back.height / v.videoHeight);
            const w = back.width / r;
            const hh = back.height / r;
            ctx.drawImage(v, (v.videoWidth - w) / 2, (v.videoHeight - hh) / 2, w, hh, 0, 0, back.width, back.height);
          }
        }
      } else {
        const c = h?.crop;
        Object.assign(
          v.style,
          c
            ? { left: `${(-c.x / c.w) * 100}%`, top: `${(-c.y / c.h) * 100}%`, width: `${100 / c.w}%`, height: `${100 / c.h}%`, objectFit: "fill", transform: "none" }
            : { left: "0", top: "0", width: "100%", height: "100%", objectFit: "cover", transform: "none" },
        );
        if (frame) frame.style.transform = `${zoom}${vis.transform}`;
        if (back) back.style.display = "none";
      }
      const local = Math.max(vis.local, 0);
      const ramp = rampAt(s.keyframes, local, s.timelineEnd - s.timelineStart); // a speed ramp: the footage follows its speed track
      const want = s.effect === "freeze" ? s.sourceStart : s.sourceStart + (ramp ? ramp.source : local * s.speed);
      if (Math.abs(v.currentTime - want) > (play ? (ramp ? 0.12 : 0.25) : 0.04)) v.currentTime = want;
      v.playbackRate = Math.min(Math.max(ramp ? ramp.speed : s.speed, 0.25), 4);
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
  }, [playhead, playing, timeline, hints]);

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

  const fade = tl.pictureFade ?? 0;
  const black = fade > 0 ? Math.max(0, 1 - playhead / fade, 1 - (tl.duration - playhead) / fade) : 0;
  const overlays = (tl.overlays ?? []).filter((o) => playhead >= o.start && playhead <= o.end);
  const caption = tl.captions.find((c) => playhead >= c.start && playhead <= c.end);

  return (
    <div
      className={`relative mx-auto aspect-[9/16] overflow-hidden rounded-xl bg-black shadow-2xl [container-type:inline-size] ${
        fill ? "h-full max-h-full max-w-full" : "w-full max-w-[min(360px,calc(62svh*9/16))]"
      }`}
    >
      {clipIds.map((cid) => (
        <div key={cid} ref={(el) => void (layers.current[cid] = el)} className="absolute inset-0 overflow-hidden" style={{ opacity: 0 }}>
          <canvas
            ref={(el) => void (backdrops.current[cid] = el)}
            width={90}
            height={160}
            aria-hidden
            className="absolute inset-0 h-full w-full scale-110"
            style={{ display: "none", filter: BACKDROP }}
          />
          <div ref={(el) => void (frames.current[cid] = el)} className="absolute inset-0" style={{ transformOrigin: "50% 50%" }}>
            <video
              ref={(el) => void (videos.current[cid] = el)}
              src={clipUrls[cid]}
              muted
              playsInline
              preload="metadata"
              onLoadedData={() => {
                if (!playing) draw(clock.current.t, false); // the first frame once the clip has loaded (not a black box)
              }}
              className="absolute h-full w-full max-w-none object-cover"
              style={{ transformOrigin: "50% 50%" }}
            />
          </div>
        </div>
      ))}
      <div ref={white} aria-hidden className="pointer-events-none absolute inset-0 z-[4] bg-white" style={{ opacity: 0 }} />
      {musicUrl && <audio ref={audio} src={musicUrl} preload="auto" />}
      {black > 0 && <div aria-hidden className="pointer-events-none absolute inset-0 z-[5] bg-black" style={{ opacity: black }} />}
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
