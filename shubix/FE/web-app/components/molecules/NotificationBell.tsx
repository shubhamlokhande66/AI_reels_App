"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSafeQuery as useQuery } from "@/lib/useSafeQuery";
import { Icon } from "@/components/atoms/Icon";
import { listCloudReels } from "@/lib/cloudReels";
import { api } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { useText } from "@/hooks/useApi";

const SEEN = "reel-notes-seen";
const seenAt = () => {
  try {
    return Number(localStorage.getItem(SEEN) ?? 0);
  } catch {
    return 0;
  }
};

/** The top bar's bell (UI/ design): the administrator's messages (Admin → Messages) first, then the Reels saved to My
 * Reels lately; a red dot for what is new. Opening it marks the messages read (on the server: every device). */
export function NotificationBell() {
  const text = useText();
  const q = useQuery({ queryKey: ["cloud-reels"], queryFn: listCloudReels, staleTime: 60_000, retry: false });
  const notes = useQuery({ queryKey: ["notifications"], queryFn: api.notifications, staleTime: 60_000, refetchInterval: 5 * 60_000, retry: false });
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
  const items = (q.data?.reels ?? []).slice(0, 6);
  const msgs = notes.data?.items ?? [];
  const fresh = items.filter((r) => new Date(r.createdAt).getTime() > seen).length + (notes.data?.unread ?? 0);
  function toggle() {
    setOpen((o) => !o);
    if (!open && notes.data?.unread) void api.readNotifications().then(() => notes.refetch()).catch(() => {});
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
        aria-label={fresh ? text("bell.new", { n: fresh }) : text("bell.title")}
        aria-expanded={open}
        className="relative grid h-10 w-10 place-items-center rounded-full text-foreground transition-colors hover:bg-surface-2"
      >
        <Icon name="bell" size={24} stroke={1.9} />
        {fresh > 0 && <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--bar)] bg-[#ff3b5c]" />}
      </button>
      {open && (
        <div role="dialog" aria-label={text("bell.title")} className="absolute right-0 top-[calc(100%+8px)] z-50 w-[min(320px,calc(100vw-32px))] rounded-2xl border border-border bg-surface p-2 shadow-[0_20px_44px_-18px_rgba(0,0,0,.7)]">
          <b className="block px-2.5 pb-1.5 pt-1 text-[13px]">{text("bell.title")}</b>
          {msgs.length > 0 && (
            <div className="mb-1 flex max-h-[50vh] flex-col gap-1 overflow-y-auto border-b border-border pb-1.5">
              {msgs.map((m) => (
                <div key={m.id} className={`flex gap-2.5 rounded-xl px-2.5 py-2 ${m.unread ? "bg-accent/8" : ""}`}>
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent/15 text-accent"><Icon name="bell" size={15} stroke={2.2} /></span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[13px] font-semibold">{m.title}</span>
                    <span className="line-clamp-4 whitespace-pre-line text-[12px] text-muted">{m.body}</span>
                    <span className="flex items-center gap-2 text-[11px] text-muted">
                      {formatRelative(m.at)}
                      {m.link && (m.link.startsWith("/")
                        ? <Link href={m.link} onClick={() => setOpen(false)} className="font-bold text-accent">{m.button || text("bell.open")}</Link>
                        : <a href={m.link} target="_blank" rel="noreferrer" className="font-bold text-accent">{m.button || text("bell.open")}</a>)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
          {items.length ? (
            items.map((r) => (
              <Link key={r.id} href="/reels?tab=saved" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 hover:bg-surface-2">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-success/15 text-success">
                  <Icon name="check" size={16} stroke={2.4} />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[13px] font-semibold">{r.name} is in My Reels</span>
                  <span className="text-[11px] text-muted">{formatRelative(r.createdAt)}</span>
                </span>
              </Link>
            ))
          ) : msgs.length ? null : (
            <p className="m-0 px-2.5 pb-2 text-[13px] text-muted">{text("bell.empty")}</p>
          )}
        </div>
      )}
    </div>
  );
}
