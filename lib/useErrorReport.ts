"use client";

import { useEffect } from "react";

/** Errors in this browser go to the administrator (Admin → Errors), so a crash on someone's phone is seen and fixed.
 * Noise is left out (browser extensions, "Script error." from other sites, ResizeObserver warnings); the same error is
 * sent once per page load. Also callable as window.__shubixReport(kind, message) by the studio. */
const NOISE = /ResizeObserver loop|^Script error\.?$|chrome-extension:|moz-extension:|safari-extension:|Non-Error promise rejection|AbortError|The user aborted/i;
const sent = new Set<string>();
export function reportError(kind: "error" | "rejection" | "studio" | "webgl", message: string, stack = "") {
  try {
    const m = String(message || "").slice(0, 400);
    if (!m || NOISE.test(m) || NOISE.test(stack) || sent.has(kind + m) || sent.size > 20) return;
    sent.add(kind + m);
    const body = JSON.stringify({ kind, message: m, stack: String(stack || "").slice(0, 2000), path: location.pathname.slice(0, 300) });
    if (navigator.sendBeacon) navigator.sendBeacon("/api/public/client-error", new Blob([body], { type: "application/json" }));
    else void fetch("/api/public/client-error", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch { /* reporting must never break anything */ }
}
export function useErrorReport() {
  useEffect(() => {
    const onErr = (e: ErrorEvent) => reportError("error", e.message, e.error?.stack ?? `${e.filename}:${e.lineno}:${e.colno}`);
    const onRej = (e: PromiseRejectionEvent) => { const r = e.reason; reportError("rejection", r instanceof Error ? r.message : String(r), r instanceof Error ? r.stack ?? "" : ""); };
    window.addEventListener("error", onErr); window.addEventListener("unhandledrejection", onRej);
    (window as unknown as { __shubixReport?: typeof reportError }).__shubixReport = reportError;
    return () => { window.removeEventListener("error", onErr); window.removeEventListener("unhandledrejection", onRej); };
  }, []);
}
