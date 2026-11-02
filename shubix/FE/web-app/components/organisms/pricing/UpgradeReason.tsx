"use client";

import { useEffect, useState } from "react";
import { DEFAULT_LOCKS, PAGE_LOCK, PLAN_NAME, type PlanId } from "@shubix/core/lib/plan-locks";
import { Icon } from "@/components/atoms";
import { usePlanLocks } from "@/hooks/useApi";

/** Sent here from a locked page, card or studio tool (/pricing?need=… or ?feature=…): say which one and which plan opens
 * it, so the person knows why they are on the plans instead of the page they tapped. */
export function UpgradeReason() {
  const [key, setKey] = useState("");
  const locks = usePlanLocks().data ?? DEFAULT_LOCKS;
  useEffect(() => {
    const s = new URLSearchParams(location.search);
    const t = setTimeout(() => setKey(s.get("need") || s.get("feature") || ""), 0);
    return () => clearTimeout(t);
  }, []);
  if (!key) return null;
  let what = "", plan: PlanId | "" = "";
  if (key === "ai") { what = "Shubix AI"; plan = "creator"; }
  else if (key.startsWith("template:")) { what = "This template"; }
  else {
    const item = PAGE_LOCK[key] ?? key; // "/create/copy" → "page:copy"
    const [g, k] = item.includes(":") ? item.split(":") : ["", item];
    for (const grp of locks.groups) for (const it of grp.items) if ((grp.id === g || !g) && it.key === k && !what) { what = it.name; plan = it.plan; }
  }
  if (!what) what = "This feature";
  return (
    <div role="status" className="mx-auto flex w-full max-w-2xl items-start gap-3 rounded-[18px] border border-accent/30 bg-[color-mix(in_srgb,var(--accent)_8%,var(--surface))] px-4 py-3 text-left">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gold text-on-accent"><Icon name="crown" size={17} /></span>
      <p className="m-0 min-w-0 flex-1 text-[13.5px] leading-relaxed">
        <b>{what}</b> {plan ? <>opens on the <b>{PLAN_NAME[plan]}</b> plan or higher.</> : <>needs a paid plan.</>} Pick a plan below to unlock it.
      </p>
    </div>
  );
}
