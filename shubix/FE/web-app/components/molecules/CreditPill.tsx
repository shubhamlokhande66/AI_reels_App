"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";
import { useText } from "@/hooks/useApi";

/** The signed-in person's credits (billing on): a gold dot and the number; a tap opens the plans and top-ups. Low
 * (2 or less) shows in the warning colour. `full`: "120 credits", else the word is for screen readers only. */
export function CreditPill({ balance, full = false, className }: { balance: number; full?: boolean; className?: string }) {
  const text = useText();
  return (
    <Link href="/pricing" title={text("nav.creditsHint")}
      className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border bg-surface py-[5px] pl-1.5 pr-2.5 text-[12.5px] font-bold tabular-nums", balance <= 2 ? "border-warning text-warning" : "border-border text-foreground", className)}>
      <i aria-hidden className="block h-[18px] w-[18px] rounded-full [background:var(--gold-gradient)]" />
      {balance.toLocaleString("en-IN")}
      <span className={full ? "" : "sr-only"}> {text("nav.credits")}</span>
    </Link>
  );
}
