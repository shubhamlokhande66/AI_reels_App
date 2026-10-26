"use client";

import { useRef } from "react";
import { cn } from "@/lib/cn";

/** Six boxes for a one-time code: typing moves on, Backspace goes back, a pasted code (or the phone's "from Messages /
 * Mail" suggestion) fills them all. `onComplete` runs when the sixth digit is in. */
export function OtpInput({ value, onChange, onComplete, invalid = false, disabled = false, label }: {
  value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; invalid?: boolean; disabled?: boolean; label: string;
}) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(6, " ").slice(0, 6).split("");
  const set = (next: string, focus: number) => {
    const v = next.replace(/\D/g, "").slice(0, 6);
    onChange(v);
    boxes.current[Math.min(focus, 5)]?.focus();
    if (v.length === 6) onComplete?.(v);
  };
  return (
    <div role="group" aria-label={label} className="flex justify-between gap-1.5 sm:gap-2">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { boxes.current[i] = el; }}
          value={d.trim()}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`${label} ${i + 1}`}
          maxLength={i === 0 ? 6 : 1} // the first box takes a whole pasted / suggested code
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            const typed = e.target.value.replace(/\D/g, "");
            if (typed.length > 1) return set(typed, typed.length); // a code pasted or suggested into one box
            const arr = value.padEnd(6, " ").slice(0, 6).split("");
            arr[i] = typed || " ";
            set(arr.join("").replace(/\s+$/, "").replace(/\s/g, ""), typed ? i + 1 : i);
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !d.trim() && i > 0) { e.preventDefault(); set(value.slice(0, i - 1), i - 1); }
            else if (e.key === "ArrowLeft" && i > 0) boxes.current[i - 1]?.focus();
            else if (e.key === "ArrowRight" && i < 5) boxes.current[i + 1]?.focus();
          }}
          onPaste={(e) => { const p = e.clipboardData.getData("text").replace(/\D/g, ""); if (p) { e.preventDefault(); set(p, p.length); } }}
          className={cn(
            "h-12 w-full min-w-0 rounded-xl border bg-surface text-center font-mono text-[22px] font-semibold tabular-nums outline-none transition-colors sm:h-14 sm:text-[24px]",
            "focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:opacity-60",
            invalid ? "border-danger" : "border-border",
          )}
        />
      ))}
    </div>
  );
}
