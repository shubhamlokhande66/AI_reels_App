"use client";

import { cn } from "@/lib/cn";

/** Pick one of a few values in a row (720p · 1080p · 4K, Free · Editor · Pro): the chosen one is raised. A radio group
 * for screen readers. `size` "sm" for rows of many (the plan locks). */
export function Segmented<V extends string>({ options, value, onChange, label, size = "md", className }: { options: readonly { value: V; label: React.ReactNode }[]; value: V; onChange: (v: V) => void; label: string; size?: "sm" | "md"; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex max-w-full gap-0.5 overflow-x-auto rounded-xl border border-border bg-surface-2 p-[3px]", className)}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={cn("shrink-0 whitespace-nowrap rounded-[9px] font-bold transition-colors", size === "sm" ? "h-7 px-2 text-[11.5px]" : "h-[34px] px-3 text-[12.5px]",
            value === o.value ? "bg-surface text-foreground shadow-[0_1px_3px_rgba(0,0,0,.15),inset_0_0_0_1px_var(--border)]" : "text-muted hover:text-foreground")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
