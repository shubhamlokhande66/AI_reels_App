import { useEffect, useState } from "react";
import { estimateProgress } from "@/lib/format";
import type { Job } from "@/types/api";
import { btnSecondary } from "./ui";

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const pct = Math.min(Math.max(Math.round(value), 0), 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
    >
      <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** A rough time-remaining line, ticking every second so it stays live between polls (and while the tab is in the background). */
function TimeEstimate({ job }: { job: Job }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const est = estimateProgress(job.createdAt, job.progress, now);
  if (!est) return <p className="mt-1 text-xs text-muted">Working out how long this will take…</p>;
  return (
    <p className="mt-1 text-xs text-muted">
      {est.elapsed} elapsed · about {est.remaining} left (estimate, total ~{est.total})
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

/** Per-stage progress for a job, straight from the backend job status, with a live time estimate. It keeps running on the
 * server even if this tab is in the background or closed — this is only the live view of that progress. */
export function ProgressStages({ job, onCancel, cancelling }: Props) {
  const active = job.status === "queued" || job.status === "processing";
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-sm font-medium">Overall</span>
        <span className="text-sm tabular-nums text-muted">{job.progress}%</span>
      </div>
      <ProgressBar value={job.progress} label="Overall progress" />
      {job.status === "processing" && <TimeEstimate job={job} />}
      <ul className="mt-6 space-y-4">
        {job.stages.map((s) => (
          <li key={s.name}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className={s.status === "pending" ? "text-muted" : ""}>
                {s.status === "completed" ? "✓ " : s.status === "failed" ? "✕ " : ""}
                {s.label}
              </span>
              <span className="tabular-nums text-muted">{s.progress}%</span>
            </div>
            <ProgressBar value={s.progress} label={s.label} />
          </li>
        ))}
      </ul>
      {onCancel && active && (
        <button type="button" className={`${btnSecondary} mt-6`} disabled={cancelling} onClick={onCancel}>
          {cancelling ? "Cancelling…" : "Cancel"}
        </button>
      )}
    </div>
  );
}
