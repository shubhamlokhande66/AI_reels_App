"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/atoms/Badge";
import { Icon } from "@/components/atoms/Icon";
import { MoreMenu, type MoreItem } from "./MoreMenu";

/** A Reel being edited (UI/ design: Continue Editing): its video playing (muted, on a loop, once the card is on
 * screen), the length, its name, when it was last edited, and its ⋯ menu. `preview` gives the video; without one the
 * picture shows with a play button. */
export function DraftCard({ href, name, thumb, duration, edited, menu, preview }: { href: string; name: string; thumb?: string | null; duration: string; edited: string; menu?: MoreItem[]; preview?: () => Promise<Blob | null> }) {
  const box = useRef<HTMLAnchorElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!preview || !el || typeof IntersectionObserver === "undefined") return;
    let url: string | null = null, live = true;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      preview().then((b) => {
        if (!live || !b) return;
        url = URL.createObjectURL(b);
        setSrc(url);
      }, () => {});
    }, { rootMargin: "120px" });
    io.observe(el);
    return () => {
      live = false;
      io.disconnect();
      if (url) URL.revokeObjectURL(url);
    };
  }, [preview]);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <a ref={box} href={href} className="group relative block aspect-[4/3] overflow-hidden rounded-2xl border border-white/10 bg-[linear-gradient(160deg,#3b2a7a,#141432)]" title={`Open ${name}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a small picture kept with the draft */}
        {thumb && <img src={thumb} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />}
        {src && (
          <video
            src={src}
            poster={thumb ?? undefined}
            muted
            loop
            autoPlay
            playsInline
            preload="metadata"
            aria-hidden
            onPlaying={() => setPlaying(true)}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        )}
        {!playing && (
          <>
            <span className="absolute inset-0 bg-black/15" />
            <span className="absolute left-1/2 top-1/2 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white/80 bg-black/40 text-white backdrop-blur-sm">
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
