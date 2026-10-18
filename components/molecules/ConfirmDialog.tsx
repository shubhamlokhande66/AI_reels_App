"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

/** "Are you sure?" as a pop-up in the app's own style, for anything that cannot be undone (deleting a Reel, a draft, a
 * project…). Call `confirmAction({...})` from anywhere: it resolves true when the person confirms, false otherwise
 * (Cancel, the backdrop, Escape). The one <ConfirmHost/> in the app shell shows it. */
export interface ConfirmAsk { title: string; body?: string; ok?: string; cancel?: string; danger?: boolean }
type Pending = ConfirmAsk & { resolve: (v: boolean) => void };

let pending: Pending | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export function confirmAction(ask: ConfirmAsk): Promise<boolean> {
  if (pending) pending.resolve(false);   // a newer question replaces an unanswered one
  if (typeof document === "undefined" || !hostMounted) return Promise.resolve(typeof window !== "undefined" ? window.confirm(ask.title) : false);
  return new Promise((resolve) => {
    pending = { ...ask, resolve };
    emit();
  });
}
let hostMounted = false;
const close = (v: boolean) => {
  const p = pending;
  pending = null;
  emit();
  p?.resolve(v);
};

export function ConfirmHost() {
  const ask = useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    () => pending,
    () => null,
  );
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    hostMounted = true;
    return () => { hostMounted = false; };
  }, []);
  useEffect(() => {
    if (!ask) return;
    const prev = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();   // the safe choice first
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(false); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [ask]);
  if (!ask) return null;
  return (
    <div className="fixed inset-0 z-[100] grid place-items-end bg-[var(--overlay)] p-4 pb-[max(16px,env(safe-area-inset-bottom))] backdrop-blur-[2px] sm:place-items-center" onClick={() => close(false)}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={ask.body ? "confirm-body" : undefined}
        className="card w-full max-w-sm animate-pop !gap-3 !p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {ask.danger && (
          <span className="grid h-11 w-11 place-items-center rounded-full" style={{ background: "color-mix(in srgb, var(--danger) 14%, transparent)", color: "var(--danger)" }} aria-hidden>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
          </span>
        )}
        <b id="confirm-title" className="text-[17px] leading-snug">{ask.title}</b>
        {ask.body && <p id="confirm-body" className="mu sm m-0">{ask.body}</p>}
        <div className="mt-1 flex gap-2">
          <button ref={cancelRef} type="button" className="btn flex-1" onClick={() => close(false)}>
            {ask.cancel ?? "Cancel"}
          </button>
          <button type="button" className={`btn flex-1 ${ask.danger ? "danger fill" : "g"}`} onClick={() => close(true)}>
            {ask.ok ?? "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
