"use client";

import { Icon } from "@/components/atoms/Icon";

export interface StepDef {
  id: string;
  title: string;
  /** what the step decided (e.g. "30 s", "6 clips"): shown at the right of its row */
  summary?: string;
  /** shown as a green badge instead of the summary (e.g. the chosen song) */
  badge?: string;
  done: boolean;
}

/** The create flow as numbered steps (design: "Create a new Reel"): the open step is a card with its content, the
 * others are rows that show what they decided. A finished step can be reopened; a later step stays locked until the
 * ones before it pass their checks. */
export function Stepper({ steps, current, onOpen, children }: { steps: StepDef[]; current: string; onOpen: (id: string) => void; children?: React.ReactNode }) {
  const at = Math.max(0, steps.findIndex((s) => s.id === current));
  const isOpen = (i: number) => steps[i].done || i <= at || (i > 0 && steps[i - 1].done);

  return (
    <nav aria-label="Steps" className="flex flex-col gap-[14px]">
      {steps.map((s, i) => {
        const active = s.id === current;
        const head = (
          <>
            <span className="n">{s.done && !active ? <Icon name="check" size={14} stroke={2.6} /> : i + 1}</span>
            <b>{s.title}</b>
            {s.badge ? <span className="badge b-ok max-w-[55%] truncate">{s.badge}</span> : s.summary ? <span className="v">{s.summary}</span> : null}
          </>
        );
        if (active)
          return (
            <section key={s.id} className="card" style={{ padding: 0, gap: 12 }} aria-label={`Step ${i + 1}: ${s.title}`} aria-current="step">
              <div className="acc" style={{ border: 0, boxShadow: "none", background: "transparent" }}>
                {head}
              </div>
              <div className="flex min-w-0 flex-col gap-4 px-[14px] pb-[14px]">{children}</div>
            </section>
          );
        return (
          <button
            key={s.id}
            type="button"
            className="acc disabled:opacity-60"
            disabled={!isOpen(i)}
            onClick={() => onOpen(s.id)}
            aria-label={`Step ${i + 1}: ${s.title}${s.done ? " (done)" : ""}${s.summary ? `, ${s.summary}` : ""}`}
          >
            {head}
            <span className="chev">
              <Icon name={isOpen(i) ? "chevron" : "lock"} size={isOpen(i) ? 18 : 15} stroke={2} />
            </span>
          </button>
        );
      })}
    </nav>
  );
}
