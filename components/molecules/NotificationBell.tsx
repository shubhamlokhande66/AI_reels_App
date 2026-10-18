"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@/components/atoms/Icon";
import { useFeatures } from "@/hooks/useApi";
import { api } from "@/lib/api";
import { linkOn } from "@/lib/features-list";
import { formatRelative } from "@/lib/format";

const SEEN = "reel-notes-seen";
const seenAt = () => {
  try {
    return Number(localStorage.getItem(SEEN) ?? 0);
  } catch {
    return 0;
  }
};

/** The top bar's bell (UI/ design): the Reels the server finished lately, a red dot for the ones not seen yet.
 * (Fast Studio only: nothing is made on the server, so it says all is caught up.) */
export function NotificationBell() {
  const features = useFeatures();
  const server = linkOn("/projects", features);
  const q = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard, enabled: server, staleTime: 30_000 });
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(Number.MAX_SAFE_INTEGER); // no dot until this device's memory is read
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setTimeout(() => setSeen(seenAt()), 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const items = (q.data?.recentlyGenerated ?? []).slice(0, 6);
  const fresh = items.filter((r) => new Date(r.createdAt).getTime() > seen).length;
  function toggle() {
    setOpen((o) => !o);
    const now = Date.now();
    setSeen(now);
    try {
      localStorage.setItem(SEEN, String(now));
    } catch {
      /* private mode */
    }
  }
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={fresh ? `Notifications, ${fresh} new` : "Notifications"}
        aria-expanded={open}
        className="relative grid h-10 w-10 place-items-center rounded-full text-foreground transition-colors hover:bg-surface-2"
      >
        <Icon name="bell" size={24} stroke={1.9} />
        {fresh > 0 && <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--bar)] bg-[#ff3b5c]" />}
      </button>
      {open && (
        <div role="dialog" aria-label="Notifications" className="absolute right-0 top-[calc(100%+8px)] z-50 w-[min(320px,calc(100vw-32px))] rounded-2xl border border-border bg-surface p-2 shadow-[0_20px_44px_-18px_rgba(0,0,0,.7)]">
          <b className="block px-2.5 pb-1.5 pt-1 text-[13px]">Notifications</b>
          {items.length ? (
            items.map((r) => (
              <Link key={r.id} href={`/projects/${r.projectId}`} onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 hover:bg-surface-2">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-success/15 text-success">
                  <Icon name="check" size={16} stroke={2.4} />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[13px] font-semibold">{r.projectName} is ready</span>
                  <span className="text-[11px] text-muted">{formatRelative(r.createdAt)}</span>
                </span>
              </Link>
            ))
          ) : (
            <p className="m-0 px-2.5 pb-2 text-[13px] text-muted">You&apos;re all caught up. Finished Reels show up here.</p>
          )}
        </div>
      )}
    </div>
  );
}
