"use client";

import { cn } from "@/lib/cn";

/** An on / off switch row (design: a label and a gold toggle). */
export function Toggle({ label, hint, on, onChange, disabled }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[12.5px]">
      <span className="min-w-0">
        <span className="block">{label}</span>
        {hint && <span className="block text-[11px] text-muted">{hint}</span>}
      </span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
        className={cn("relative h-6 w-[42px] shrink-0 rounded-full border p-0 transition-colors disabled:opacity-50", on ? "border-accent bg-[var(--chip-on)]" : "border-border bg-surface-2")}>
        <i className={cn("absolute top-0.5 h-[18px] w-[18px] rounded-full transition-[left]", on ? "left-5 bg-accent" : "left-0.5 bg-muted")} />
      </button>
    </div>
  );
}
