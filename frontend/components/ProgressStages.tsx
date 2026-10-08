import { useEffect, useState } from "react";
import { estimateProgress } from "@/lib/format";
import type { Job } from "@/types/api";
import { btnSecondary } from "./ui";

/** A live clock that re-renders every second (so estimates keep moving between polls). */
function useNow(active: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function clock(d: Date): string {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function eta(seconds: number): string {
  if (seconds < 60) return `${Math.max(Math.round(seconds), 1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${s.toString().padStart(2, "0")}s`;
}

/**
 * The app's progress bar: a gold bar with a moving sheen, the percentage, and (``showEta``) how long is left and the
 * clock time it will be ready, measured from how fast it has actually moved so far (uploads, analysis, rendering).
 * ``size`` "sm" is the thin variant for sub-steps.
 */
export function ProgressBar({ value, label, showEta = false, size = "md" }: {
  value: number;
  label: string;
  showEta?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const pct = Math.min(Math.max(value, 0), 100);
  const shown = Math.round(pct);
  const done = shown >= 100;
  const now = useNow(showEta && !done && pct > 0);
  const [startedAt] = useState(() => Date.now()); // the bar appears when the work starts: speed is measured from then
  let line: string | null = null;
  if (showEta && !done) {
    const elapsed = (now.getTime() - startedAt) / 1000;
    if (elapsed > 2 && pct >= 2) {
      const left = (elapsed / pct) * (100 - pct);
      line = `about ${eta(left)} left · ready at ${clock(new Date(now.getTime() + left * 1000))}`;
    } else {
      line = "measuring speed…";
    }
  }
  const height = size === "sm" ? "h-1.5" : size === "lg" ? "h-3.5" : "h-2.5";
  return (
    <div className="w-full">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={shown}
        className={`lux-progress-track ${height} w-full`}
      >
        <div className="lux-progress-fill" data-done={done} style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }} />
      </div>
      {showEta && (
        <div className="mt-1.5 flex items-baseline justify-between text-xs text-muted">
          <span>{done ? "Done" : line ?? "starting…"}</span>
          <span className="tabular-nums text-foreground">{shown}%</span>
        </div>
      )}
    </div>
  );
}

/** The job's own estimate (from when the job started on the server), ticking every second. */
function JobEstimate({ job }: { job: Job }) {
  const now = useNow(true);
  const est = estimateProgress(job.createdAt, job.progress, now);
  if (!est) return <p className="text-sm text-muted">Measuring how long this takes…</p>;
  const leftMs = Math.max((now.getTime() - new Date(job.createdAt).getTime()) / Math.max(job.progress, 1) * (100 - job.progress), 0);
  return (
    <p className="text-sm text-muted">
      About <span className="text-foreground">{est.remaining}</span> left · ready at{" "}
      <span className="text-foreground">{clock(new Date(now.getTime() + leftMs))}</span>
      <span className="ml-2 text-xs">({est.elapsed} so far)</span>
    </p>
  );
}

interface Props {
  job: Job;
  /** Shows a Cancel button while the job is queued/processing, when given. Cancelling does not stop it instantly —
   * the server notices at its next progress tick (frequent, including mid-render) — so keep polling the job as usual. */
  onCancel?: () => void;
  cancelling?: boolean;
}

/** The job's progress, straight from the backend job status: a large gold percentage, the animated bar, a live
 * estimate with the clock time it will be ready, and every stage as a step (done ✓, running, waiting). It keeps
 * running on the server even if this tab is in the background or closed — this is only the live view of it. */
export function ProgressStages({ job, onCancel, cancelling }: Props) {
  const active = job.status === "queued" || job.status === "processing";
  const current = job.stages.find((s) => s.status === "running") ?? job.stages.find((s) => s.status === "pending");
  return (
    <div className="lux-enter">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="lux-eyebrow">{job.status === "queued" ? "In the queue" : active ? "Now" : job.status}</p>
          <p className="mt-1 font-display text-xl">{active ? current?.label ?? "Working…" : job.status === "completed" ? "Finished" : "Stopped"}</p>
        </div>
        <span className="lux-gold-text font-display text-5xl leading-none tabular-nums">{job.progress}%</span>
      </div>
      <div className="mt-4">
        <ProgressBar value={job.progress} label="Overall progress" size="lg" />
      </div>
      <div className="mt-2">{job.status === "processing" && <JobEstimate job={job} />}</div>
      <ol className="mt-6 space-y-3">
        {job.stages.map((s) => {
          const running = s.status === "running";
          return (
            <li key={s.name} className="flex items-center gap-3">
              <span
                aria-hidden
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[11px] ${
                  s.status === "completed"
                    ? "border-accent/60 bg-accent/15 text-accent"
                    : s.status === "failed"
                      ? "border-danger/50 text-danger"
                      : running
                        ? "border-accent text-accent"
                        : "border-border text-muted"
                }`}
              >
                {s.status === "completed" ? "✓" : s.status === "failed" ? "✕" : running ? <span className="h-2 w-2 animate-ping rounded-full bg-accent" /> : ""}
              </span>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className={s.status === "pending" ? "text-muted" : running ? "text-foreground" : "text-foreground/80"}>{s.label}</span>
                  <span className="tabular-nums text-xs text-muted">{s.progress}%</span>
                </div>
                <ProgressBar value={s.progress} label={s.label} size="sm" />
              </div>
            </li>
          );
        })}
      </ol>
      {onCancel && active && (
        <button type="button" className={`${btnSecondary} mt-6`} disabled={cancelling} onClick={onCancel}>
          {cancelling ? "Cancelling…" : "Cancel"}
        </button>
      )}
    </div>
  );
}
