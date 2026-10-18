"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/atoms/Badge";
import { Icon } from "@/components/atoms/Icon";
import { MoreMenu, type MoreItem } from "./MoreMenu";

/** At most this many draft videos play at once (each is a full-size clip: decoding many at once makes the page heavy). */
const MAX_PLAYING = 3;
const playing = new Set<HTMLVideoElement>();
const waiting = new Set<HTMLVideoElement>();
function wantPlay(v: HTMLVideoElement) {
  if (playing.has(v)) return;
  if (playing.size >= MAX_PLAYING) return void waiting.add(v);
  playing.add(v);
  v.play().catch(() => playing.delete(v));
}
function stopPlay(v: HTMLVideoElement) {
  waiting.delete(v);
  if (!playing.delete(v)) return;
  v.pause();
  const next = waiting.values().next().value; // the next one on screen takes its turn
  if (next) { waiting.delete(next); wantPlay(next); }
}

/** A Reel being edited (UI/ design: Continue Editing): its video playing (muted, on a loop) while the card is on
 * screen, the length, its name, when it was last edited, and its ⋯ menu. `preview` gives the video (read once, when
 * the card first comes near the screen); without one the picture shows with a play button. */
export function DraftCard({ href, name, thumb, duration, edited, menu, preview }: { href: string; name: string; thumb?: string | null; duration: string; edited: string; menu?: MoreItem[]; preview?: () => Promise<Blob | null> }) {
  const box = useRef<HTMLAnchorElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const load = useRef(preview);
  const [src, setSrc] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    load.current = preview;
  }, [preview]);

  // the clip: read once, when the card comes near the screen (a new `preview` function on each render changes nothing)
  useEffect(() => {
    const el = box.current;
    if (!load.current || !el || typeof IntersectionObserver === "undefined") return;
    let url: string | null = null, live = true;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      load.current?.().then((b) => {
        if (!live || !b) return;
        url = URL.createObjectURL(b);
        setSrc(url);
      }, () => {});
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => {
      live = false;
      io.disconnect();
      if (url) URL.revokeObjectURL(url);
    };
  }, []);

  // it plays only while at least half of it is on screen (and the tab is open), at most MAX_PLAYING at once
  useEffect(() => {
    const v = video.current, el = box.current;
    if (!src || !v || !el) return;
    let inView = false;
    const sync = () => (inView && document.visibilityState === "visible" ? wantPlay(v) : stopPlay(v));
    const io = new IntersectionObserver(([e]) => { inView = e.intersectionRatio >= 0.5; sync(); }, { threshold: [0, 0.5] });
    io.observe(el);
    document.addEventListener("visibilitychange", sync);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
      stopPlay(v);
    };
  }, [src]);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <a ref={box} href={href} className="group relative block aspect-[4/3] overflow-hidden rounded-2xl border border-white/10 bg-[linear-gradient(160deg,#3b2a7a,#141432)]" title={`Open ${name}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a small picture kept with the draft */}
        {thumb && <img src={thumb} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />}
        {src && (
          <video
            ref={video}
            src={src}
            poster={thumb ?? undefined}
            muted
            loop
            playsInline
            preload="metadata"
            aria-hidden
            onPlaying={() => setShown(true)}
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        {!shown && (
          <>
            <span className="absolute inset-0 bg-black/15" />
            <span className="absolute left-1/2 top-1/2 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white/80 bg-black/45 text-white">
              <Icon name="play" size={18} />
            </span>
          </>
        )}
        <Badge tone="dark" className="absolute bottom-2 right-2">
          {duration}
        </Badge>
      </a>
      <div className="flex items-start justify-between gap-1">
        <a href={href} className="flex min-w-0 flex-col">
          <b className="truncate text-[13.5px] hover:text-accent">{name}</b>
          <span className="text-[11.5px] text-muted">{edited}</span>
        </a>
        {menu && <MoreMenu items={menu} label={`More for ${name}`} />}
      </div>
    </div>
  );
}
