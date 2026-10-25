"use client";

import { Icon } from "@/components/atoms/Icon";
import { cn } from "@/lib/cn";
import { useT } from "@/hooks/useApi";

const GOLD = "bg-[linear-gradient(135deg,#fff1b8_0%,#f5c84c_42%,#d49a12_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,.65),0_0_0_1px_rgba(180,128,10,.35),0_4px_12px_-4px_rgba(212,154,18,.7)]";

/** The tag on a page of a higher plan (lib/plan-locks.ts lockTag), in gold, its words from Admin → CMS: on a Home card (`card`) a pill with a
 * crown and "Upgrade" on one line; in the menu a crown coin, so the page's name keeps its room. */
export function LockBadge({ card = false }: { card?: boolean }) {
  const t = useT(), text = t("plan.lockTag");
  if (!card)
    return (
      <span title={t("plan.lockHint")} className={cn("ml-auto grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full", GOLD)}>
        <Icon name="crown" size={12} stroke={2.4} color="#3a2604" />
        <span className="sr-only">{text}</span>
      </span>
    );
  return (
    <span title={t("plan.lockHint")} className={cn("inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-[10px] font-extrabold uppercase leading-none tracking-[0.08em] text-[#3a2604]", GOLD)}>
      <Icon name="crown" size={12} stroke={2.4} color="#3a2604" />
      {text}
    </span>
  );
}
