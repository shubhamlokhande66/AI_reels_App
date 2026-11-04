"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Button } from "@/components/atoms/Button";
import { useText } from "@/hooks/useApi";
import { ApiError } from "@/lib/api";
import { dismissToast, subscribeToasts, toast, toastList } from "@/lib/toast";

const EMPTY: never[] = [];

/** The message popup (lib/toast.ts), one at a time at the centre of the screen. An action whose error nobody caught (a
 * click that failed quietly) shows its message here too, so nothing fails without a word. */
export function Toaster() {
  const list = useSyncExternalStore(subscribeToasts, toastList, () => EMPTY), text = useText();
  useEffect(() => {
    const on = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      if (r instanceof ApiError && r.status !== 401 && r.code !== "AUTH_REQUIRED") toast.error(r.message);
    };
    window.addEventListener("unhandledrejection", on);
    return () => window.removeEventListener("unhandledrejection", on);
  }, []);
  const t = list[0];
  if (!t) return null;
  return (
    <div data-popup className="fixed inset-0 z-[100] grid place-items-center bg-black/70 px-4 backdrop-blur-md">
      <div role={t.kind === "error" ? "alert" : "dialog"} aria-modal="true" className="relative flex animate-enter w-full max-w-[520px] flex-col gap-4 overflow-hidden rounded-[28px] border border-accent/30 bg-surface p-6 text-foreground shadow-[0_32px_90px_-24px_rgba(0,0,0,.75),0_0_70px_-28px_var(--accent)]">
        <i className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-accent to-transparent" />
        <p className="m-0 break-words text-center text-[16px] font-semibold leading-snug tracking-tight">{t.text}</p>
        <Button full onClick={() => dismissToast(t.id)}>{text("common.ok")}</Button>
      </div>
    </div>
  );
}
