"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ProgressBar } from "./ProgressStages";
import { btnPrimary, btnSecondary } from "./ui";

export type LogLine = { id: string; text: string; status: "running" | "done" | "error" | "warn" | "info"; at?: number };

export interface TaskLogState {
  title: string;
  lines: LogLine[];
  progress: number | null; // 0..100, null = no bar
  barKey: string; // a new key restarts the bar's time estimate (each phase measures its own speed)
  state: "running" | "ok" | "problem" | "error";
  summary?: string;
}

/** A popup that shows, line by line, what the app is doing (upload, analysis ...) while it works. It closes by itself
 * when everything went well (``autoCloseMs``); with problems it stays open until the person chooses to review them. */
export function TaskLog({ log, onClose, onRetry, autoCloseMs = 1400, reviewLabel = "Review" }: {
  log: TaskLogState;
  onClose: () => void;
  onRetry?: () => void; // shown when the work stopped on an error: carries on from where it stopped
  autoCloseMs?: number;
  reviewLabel?: string;
}) {
  useEffect(() => {
    if (log.state !== "ok") return;
    const t = setTimeout(onClose, autoCloseMs);
    return () => clearTimeout(t);
  }, [log.state, onClose, autoCloseMs]);

  // rendered at the top of the page (a portal), so no parent layout or animation can trap it: it always covers the window
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  // a live clock for the running step, so a slow step visibly ticks instead of looking frozen
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (log.state !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [log.state]);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // the page behind does not scroll while the popup is open
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  if (!mounted) return null;
  return createPortal(
    <div className="lux-overlay fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-label={log.title}>
      <div className="lux-card lux-enter flex max-h-[90vh] w-full max-w-2xl flex-col rounded-3xl p-8 shadow-2xl">
        <p className="lux-eyebrow">{log.state === "running" ? "Working" : log.state === "ok" ? "Done" : "Needs your attention"}</p>
        <h2 className="mt-1 text-2xl">{log.title}</h2>
        {log.progress !== null ? (
          <div className="mt-4">
            <ProgressBar key={log.barKey} value={log.progress} label={log.title} showEta size="md" />
          </div>
        ) : log.state === "running" ? (
          // a step without a percentage still shows that it is moving
          <div className="mt-4">
            <div className="lux-progress-track h-2.5 w-full" role="progressbar" aria-label={log.title} aria-busy="true">
              <div className="lux-activity h-full w-1/3 rounded-full" />
            </div>
            <p className="mt-1.5 text-xs text-muted">working…</p>
          </div>
        ) : null}
        <ol className="mt-5 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 text-sm" aria-live="polite">
          {log.lines.map((l) => (
            <li key={l.id} className="lux-enter flex items-start gap-3">
              <span
                aria-hidden
                className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] ${
                  l.status === "done"
                    ? "bg-accent/15 text-accent"
                    : l.status === "error"
                      ? "bg-danger/15 text-danger"
                      : l.status === "warn"
                        ? "bg-warning/15 text-warning"
                        : l.status === "running"
                          ? "border border-accent text-accent"
                          : "text-muted"
                }`}
              >
                {l.status === "done" ? "✓" : l.status === "error" ? "✕" : l.status === "warn" ? "!" : l.status === "running" ? (
                  <span className="h-1.5 w-1.5 animate-ping rounded-full bg-accent" />
                ) : "·"}
              </span>
              <span className={l.status === "running" ? "text-foreground" : l.status === "info" ? "text-muted" : "text-foreground/85"}>
                {l.text}
                {l.status === "running" && l.at && now - l.at >= 3000 && (
                  <span className="ml-2 tabular-nums text-xs text-muted">
                    {Math.round((now - l.at) / 1000)}s{now - l.at > 30_000 ? " · taking longer than usual…" : ""}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
        {log.summary && (
          <p className={`mt-4 rounded-2xl border p-3 text-sm ${log.state === "ok" ? "border-success/30 bg-success/10 text-success" : "border-warning/40 bg-warning/10"}`}>
            {log.summary}
          </p>
        )}
        {log.state !== "running" && log.state !== "ok" && (
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className={log.state === "error" ? btnSecondary : btnPrimary} onClick={onClose}>
              {log.state === "error" ? "Close" : reviewLabel}
            </button>
            {log.state === "error" && onRetry && (
              <button type="button" className={btnPrimary} onClick={onRetry}>
                ↻ Retry
              </button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
