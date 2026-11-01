"use client";

import { Icon } from "@/components/atoms/Icon";
import { cn } from "@/lib/cn";
import { useText } from "@/hooks/useApi";
import { gradients } from "@shubix/ui-web";

// the lock's gold (Shared/ui-core gradients.lock; the phone app draws the same)
const [l1, l2, l3] = gradients.lock, INK = gradients.lockInk[0];
const FILL = { background: `linear-gradient(135deg, ${l1} 0%, ${l2} 42%, ${l3} 100%)` };
const GOLD = "shadow-[inset_0_1px_0_rgba(255,255,255,.65),0_0_0_1px_rgba(180,128,10,.35),0_4px_12px_-4px_rgba(212,154,18,.7)]";

/** The tag on a page of a higher plan (lib/plan-locks.ts lockTag), in gold, its words from Admin → CMS: on a Home card (`card`) a pill with a
 * crown and "Upgrade" on one line; in the menu a crown coin, so the page's name keeps its room. */
export function LockBadge({ card = false }: { card?: boolean }) {
  const text = useText(), lockTag = text("plan.lockTag");
  if (!card)
    return (
      <span title={text("plan.lockHint")} className={cn("ml-auto grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full", GOLD)} style={FILL}>
        <Icon name="crown" size={12} stroke={2.4} color={INK} />
        <span className="sr-only">{lockTag}</span>
      </span>
    );
  return (
    <span title={text("plan.lockHint")} className={cn("inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-[10px] font-extrabold uppercase leading-none tracking-[0.08em]", GOLD)} style={{ ...FILL, color: INK }}>
      <Icon name="crown" size={12} stroke={2.4} color={INK} />
      {lockTag}
    </span>
  );
}
