import { useEffect, useState } from "react";
import { estimateProgress } from "@/lib/format";
import type { Job } from "@/types/api";
import { Icon } from "@/components/atoms/Icon";

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
  if (!est) return <p className="mu sm">Working out how long this takes…</p>;
  const leftMs = Math.max((now.getTime() - new Date(job.createdAt).getTime()) / Math.max(job.progress, 1) * (100 - job.progress), 0);
  return (
    <p className="mu sm">
      About <span className="text-foreground">{est.remaining}</span> left · ready at <span className="text-foreground">{clock(new Date(now.getTime() + leftMs))}</span>
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
  return (
    <div className="flex flex-col gap-3">
      <div className="row">
        <div className="bar flex-1" style={{ height: 8 }} role="progressbar" aria-label="Overall progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.progress}>
          <i style={{ width: `${Math.max(job.progress, 2)}%` }} />
        </div>
        <span className="mono sm">{job.progress}%</span>
      </div>
      {job.status === "processing" && <JobEstimate job={job} />}
      {job.status === "queued" && job.queuePosition ? (
        <p className="mu sm" role="status">
          {job.queuePosition === 1 ? "Yours is next: it starts as soon as a spot is free." : `Waiting in line: ${job.queuePosition - 1} Reel${job.queuePosition === 2 ? "" : "s"} ahead of yours.`}
        </p>
      ) : null}
      <ol className="flex flex-col gap-3" aria-label="Steps">
        {job.stages.map((s) => {
          const cls = s.status === "completed" ? "done" : s.status === "failed" ? "bad" : s.status === "running" ? "cur" : "todo";
          return (
            <li key={s.name} className={`chk ${cls}`}>
              <span className="o" aria-hidden>
                {s.status === "completed" ? <Icon name="check" size={12} stroke={3} /> : s.status === "failed" ? <Icon name="close" size={11} stroke={3} /> : null}
              </span>
              <span className="min-w-0 flex-1">{s.label}</span>
              {s.status === "running" && <span className="mono xs mu">{s.progress}%</span>}
            </li>
          );
        })}
      </ol>
      {onCancel && active && (
        <button type="button" className="btn sm self-start" disabled={cancelling} onClick={onCancel}>
          {cancelling ? "Stopping…" : "Stop making this Reel"}
        </button>
      )}
    </div>
  );
}
