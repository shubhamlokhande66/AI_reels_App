"use client";

import { cn } from "@/lib/cn";

/** A segmented tab bar (account sections, admin settings, My Reels…): the chosen tab is raised. Tabs share the width;
 * `scroll` lets a long row scroll sideways instead. */
export function Tabs<K extends string>({ items, value, onChange, label, scroll = false, className }: { items: readonly { id: K; label: React.ReactNode }[]; value: K; onChange: (id: K) => void; label: string; scroll?: boolean; className?: string }) {
  return (
    <div role="tablist" aria-label={label} className={cn("grid auto-cols-fr grid-flow-col gap-0.5 rounded-xl border border-border bg-surface-2 p-[3px]", scroll && "auto-cols-max overflow-x-auto", className)}>
      {items.map((it) => (
        <button key={it.id} type="button" role="tab" aria-selected={value === it.id} onClick={() => onChange(it.id)}
          className={cn("grid h-[34px] place-items-center whitespace-nowrap rounded-[9px] px-2.5 text-[12.5px] font-bold transition-colors", value === it.id ? "bg-surface text-foreground shadow-[0_1px_3px_rgba(0,0,0,.15),inset_0_0_0_1px_var(--border)]" : "text-muted hover:text-foreground")}>
          {it.label}
        </button>
      ))}
    </div>
  );
}
