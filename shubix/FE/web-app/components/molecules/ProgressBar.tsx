import { useEffect, useState } from "react";

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
