"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Icon } from "@/components/atoms/Icon";
import { cn } from "@/lib/cn";
import { ApiError } from "@/lib/api";
import { dismissToast, subscribeToasts, toast, toastList } from "@/lib/toast";

const EMPTY: never[] = [];

/** The pop-up notes (lib/toast.ts), above the bottom bar on a phone, bottom-centre on a computer. An action whose
 * error nobody caught (a click that failed quietly) shows its message here too, so nothing fails without a word. */
export function Toaster() {
  const list = useSyncExternalStore(subscribeToasts, toastList, () => EMPTY);
  useEffect(() => {
    const on = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      if (r instanceof ApiError && r.status !== 401 && r.code !== "AUTH_REQUIRED") toast.error(r.message);
    };
    window.addEventListener("unhandledrejection", on);
    return () => window.removeEventListener("unhandledrejection", on);
  }, []);
  if (!list.length) return null;
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(140px+env(safe-area-inset-bottom))] z-[95] flex flex-col items-center gap-2 px-4 md:bottom-16">
      {list.map((t) => (
        <div key={t.id} role={t.kind === "error" ? "alert" : "status"}
          className={cn("pointer-events-auto flex w-full max-w-[420px] animate-enter items-start gap-2.5 rounded-2xl border bg-surface px-3.5 py-3 text-[13.5px] font-semibold shadow-[0_16px_40px_-18px_rgba(0,0,0,.65)] motion-reduce:animate-none",
            t.kind === "error" ? "border-danger/40" : t.kind === "success" ? "border-success/40" : "border-border")}>
          <span className={cn("mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full text-white", t.kind === "error" ? "bg-danger" : t.kind === "success" ? "bg-success" : "bg-gold")}>
            <Icon name={t.kind === "error" ? "close" : t.kind === "success" ? "check" : "sparkle"} size={12} stroke={3} />
          </span>
          <span className="min-w-0 flex-1 break-words leading-snug">{t.text}</span>
          <button type="button" aria-label="Close" onClick={() => dismissToast(t.id)} className="-m-1 shrink-0 rounded-full p-1 text-muted hover:text-foreground">
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
