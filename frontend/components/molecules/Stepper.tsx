"use client";

export interface StepDef {
  id: string;
  title: string;
  summary?: string; // shown under a finished step (e.g. "6 clips · 19s of footage")
  done: boolean;
}

/** The create flow's step bar: numbered steps joined by a gold line; finished steps can be reopened, later steps are
 * locked until the ones before them pass their checks. Phones get a compact bar (circles + lines, the current step's
 * name below); wider screens show every step's name and summary. */
export function Stepper({ steps, current, onOpen }: { steps: StepDef[]; current: string; onOpen: (id: string) => void }) {
  const at = Math.max(0, steps.findIndex((s) => s.id === current));
  const isOpen = (i: number) => steps[i].done || i <= at || (i > 0 && steps[i - 1].done);

  const dot = (s: StepDef, i: number, size: string) => {
    const active = s.id === current;
    return (
      <button
        type="button"
        disabled={!isOpen(i) || active}
        onClick={() => onOpen(s.id)}
        aria-current={active ? "step" : undefined}
        aria-label={`Step ${i + 1}: ${s.title}${s.done ? " (done)" : ""}`}
        className={`grid shrink-0 place-items-center rounded-full border text-sm font-semibold transition-all ${size} ${
          active
            ? "lux-btn-gold border-transparent"
            : s.done
              ? "border-accent/60 bg-accent/10 text-accent hover:bg-accent/20"
              : "border-border text-muted"
        }`}
      >
        {s.done && !active ? "✓" : i + 1}
      </button>
    );
  };
  const line = (lit: boolean) => <span aria-hidden className={`h-px flex-1 ${lit ? "bg-accent/60" : "bg-border"}`} />;
  const cur = steps[at];

  return (
    <nav aria-label="Steps" className="lux-card rounded-3xl px-4 py-4 sm:px-5">
      {/* phones */}
      <div className="sm:hidden">
        <div className="flex items-center gap-2">
          {steps.map((s, i) => (
            <div key={s.id} className={`flex items-center gap-2 ${i < steps.length - 1 ? "flex-1" : ""}`}>
              {dot(s, i, "h-9 w-9")}
              {i < steps.length - 1 && line(i < at)}
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-baseline justify-between gap-3">
          <p className="text-sm font-medium">{cur?.title}</p>
          <p className="shrink-0 text-xs text-muted">
            Step {at + 1} of {steps.length}
          </p>
        </div>
        {/* what the finished steps decided, so nothing is hidden on a small screen */}
        {steps.some((s) => s.done && s.summary && s.id !== current) && (
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {steps.map((s) =>
              s.done && s.summary && s.id !== current ? (
                <li key={s.id} className="truncate">
                  <span className="text-accent">✓</span> {s.title}: {s.summary}
                </li>
              ) : null,
            )}
          </ul>
        )}
      </div>

      {/* tablets and desktop */}
      <ol className="hidden sm:flex sm:items-start">
        {steps.map((s, i) => {
          const active = s.id === current;
          return (
            <li key={s.id} className="flex min-w-0 flex-1 flex-col items-center text-center">
              <div className="flex w-full items-center justify-center">
                <span className={`h-px flex-1 ${i === 0 ? "opacity-0" : i <= at ? "bg-accent/60" : "bg-border"}`} />
                {dot(s, i, "h-9 w-9")}
                <span className={`h-px flex-1 ${i === steps.length - 1 ? "opacity-0" : i < at ? "bg-accent/60" : "bg-border"}`} />
              </div>
              <div className="mt-2 w-full min-w-0 px-2">
                <p className={`text-sm ${active ? "text-foreground" : s.done ? "text-foreground/85" : "text-muted"}`}>{s.title}</p>
                {s.summary && <p className="mt-0.5 truncate text-xs text-muted">{s.summary}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
