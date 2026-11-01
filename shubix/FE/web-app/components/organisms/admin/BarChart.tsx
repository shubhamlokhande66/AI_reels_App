"use client";

import { useState } from "react";

/** One series of bars (sign-ups per day, revenue per month): thin gold bars, a hover/tap tooltip, the busiest value on
 * the axis, and a table for screen readers. */
export function BarChart({ label, data, format = String }: { label: string; data: { key: string; short: string; value: number }[]; format?: (n: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const h = hover === null ? null : data[hover];
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2.5 text-[11px] text-muted" aria-hidden>
        <span>{h ? `${h.key}: ${format(h.value)}` : `Peak ${format(Math.max(0, ...data.map((d) => d.value)))}`}</span>
        <span>Total {format(data.reduce((s, d) => s + d.value, 0))}</span>
      </div>
      <div role="img" aria-label={label} className="relative flex h-36 items-end gap-[2px] border-b border-border" onMouseLeave={() => setHover(null)}>
        {data.map((d, i) => (
          <button
            key={d.key}
            type="button"
            tabIndex={-1}
            aria-hidden
            className="group flex h-full min-w-0 flex-1 items-end"
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onClick={() => setHover(i)}
          >
            <span
              className="w-full rounded-t-md transition-[height,opacity] duration-500"
              style={{
                height: `${d.value > 0 ? Math.max(3, (d.value / max) * 100) : 1}%`,
                background: d.value > 0 ? "var(--gold-gradient)" : "var(--border)",
                opacity: hover === null || hover === i ? 1 : 0.45,
              }}
            />
          </button>
        ))}
      </div>
      <div className="flex gap-[2px]" aria-hidden>
        {data.map((d, i) => (
          <span key={d.key} className="text-muted min-w-0 flex-1 truncate text-center text-[10px]">
            {data.length <= 12 || i % 2 === 0 ? d.short : ""}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.key}>
              <th scope="row">{d.key}</th>
              <td>{format(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
