import Link from "next/link";
import { Icon } from "@/components/atoms/Icon";

/** The top bar's plan pill (UI/ design): "Pro" with a crown, to the plans; the plan's name once one is bought. */
export function ProPill({ plan }: { plan?: string | null }) {
  const paid = plan && plan.toLowerCase() !== "free";
  return (
    <Link
      href="/pricing"
      title={paid ? `${plan} plan` : plan ? "Free plan: see Editor & Pro" : "Plans & pricing"}
      className="inline-flex h-10 items-center gap-1.5 rounded-full border border-[#f5c84c]/80 px-3.5 text-[14px] font-bold text-foreground transition-colors hover:bg-[#f5c84c]/10"
    >
      <Icon name="crown" size={18} stroke={2} color="#f5c84c" />
      {paid ? plan : plan ? <>Free<span className="text-[12px] font-semibold text-[#f5c84c]">· Upgrade</span></> : "Plans"}
    </Link>
  );
}
