"use client";

import Link from "next/link";
import { Icon } from "@/components/atoms/Icon";
import { useT } from "@/hooks/useApi";

/** The top bar's plan pill (UI/ design): "Pro" with a crown, to the plans; the plan's name once one is bought.
 * `compact`: beside a page's title on phones, without "· Upgrade". */
export function ProPill({ plan, compact = false }: { plan?: string | null; compact?: boolean }) {
  const t = useT();
  const paid = plan && plan.toLowerCase() !== "free";
  return (
    <Link
      href="/pricing"
      title={paid ? t("nav.planSuffix", { plan }) : plan ? t("common.planHint") : t("nav.pricing")}
      className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-[#f5c84c]/80 ${compact ? "px-3" : "px-3.5"} text-[14px] font-bold text-foreground transition-colors hover:bg-[#f5c84c]/10`}
    >
      <Icon name="crown" size={18} stroke={2} color="#f5c84c" />
      {paid ? plan : plan ? <>{t("plan.free")}{!compact && <span className="text-[12px] font-semibold text-[#f5c84c]">{t("plan.freeUpgrade")}</span>}</> : t("plan.plans")}
    </Link>
  );
}
