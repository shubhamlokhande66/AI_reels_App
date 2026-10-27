"use client";

import Link from "next/link";
import { Icon } from "@/components/atoms/Icon";
import { useAdmin, useT } from "@/hooks/useApi";
import { cn } from "@/lib/cn";

/** The top bar's plan pill, one look per plan (the plan's id decides it, its name is the admin's):
 *  - Free: quiet, with a small gradient "Upgrade ↗" chip (on phones just the chip's arrow)
 *  - Editor: a violet gradient edge and a sparkle (Shubix AI) in a gradient circle
 *  - Pro: a gold edge, a soft gold glow and a crown in a gold circle
 *  - the administrator: the Pro look, "Admin · all open"
 * Every pill leads to the plans. `compact`: beside a page's title on phones. */
const RING = {
  editor: "[background:linear-gradient(var(--surface),var(--surface))_padding-box,linear-gradient(120deg,#c084fc,#7c3aed_60%,#6d5dfc)_border-box]",
  pro: "[background:linear-gradient(135deg,color-mix(in_srgb,#f5c84c_14%,var(--surface)),var(--surface))_padding-box,linear-gradient(120deg,#fde68a,#f5c84c_40%,#d4932c)_border-box] shadow-[0_6px_18px_-10px_rgba(212,147,44,.75)]",
};
export function ProPill({ plan, planId, compact = false }: { plan?: string | null; planId?: string | null; compact?: boolean }) {
  const t = useT(), a = useAdmin();
  // the administrator has every plan's pages, Shubix AI and no credits taken: the Pro look, saying so
  if (a.admin && a.required) { plan = t("plan.admin"); planId = "pro"; }
  const id = (planId ?? plan ?? "").toLowerCase();
  const tier: "free" | "editor" | "pro" | "none" = !plan ? "none" : id === "free" ? "free" : id === "pro" || id === "business" ? "pro" : "editor";
  const title = tier === "free" ? t("common.planHint") : tier === "none" ? t("nav.pricing") : t("nav.planSuffix", { plan: plan ?? "" });
  const base = cn("group inline-flex h-10 shrink-0 items-center rounded-full border text-[13.5px] font-semibold transition-[transform,box-shadow] hover:-translate-y-px", compact ? "gap-1.5 pl-1.5 pr-3" : "gap-2 pl-1.5 pr-3.5");

  if (tier === "free" || tier === "none")
    return (
      <Link href="/pricing" title={title} className={cn(base, "border-border bg-surface text-foreground hover:border-accent/50", compact ? "pr-1.5" : "pr-1.5")}>
        <span className="pl-2 text-muted">{tier === "free" ? t("plan.free") : t("plan.plans")}</span>
        <span className="inline-flex h-7 items-center gap-1 rounded-full bg-[image:var(--gold-gradient)] px-2.5 text-[11.5px] font-bold text-white shadow-[0_6px_14px_-8px_var(--accent)]">
          {!compact && t("plan.upgrade")}
          <Icon name="back" size={12} stroke={2.6} className="rotate-[135deg]" />
        </span>
      </Link>
    );
  return (
    <Link href="/pricing" title={title} className={cn(base, "border-transparent text-foreground", RING[tier])}>
      <span className={cn("grid h-7 w-7 place-items-center rounded-full text-white",
        tier === "pro" ? "bg-[linear-gradient(135deg,#fde68a,#f5c84c_45%,#c98a1f)] text-[#3a2604] shadow-[inset_0_1px_0_rgba(255,255,255,.6)]" : "bg-[image:var(--gold-gradient)]")}>
        <Icon name={tier === "pro" ? "crown" : "sparkle"} size={14} stroke={2.2} />
      </span>
      <span className={tier === "pro" ? "bg-[linear-gradient(90deg,#b7791f,#d4932c)] bg-clip-text text-transparent dark:bg-[linear-gradient(90deg,#fde68a,#f5c84c)]" : ""}>{plan}</span>
    </Link>
  );
}
