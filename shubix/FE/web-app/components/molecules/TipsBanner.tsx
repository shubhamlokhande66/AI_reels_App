"use client";

import { Icon } from "@/components/atoms/Icon";
import { useText } from "@/hooks/useApi";

/** "Tips for Better Reels · Simple tips to get more views" (UI/ design): the row that leads to the tips. */
export function TipsBanner({ href = "#tips-h" }: { href?: string }) {
  const text = useText();
  return (
    <a
      href={href}
      className="group flex items-center gap-3 rounded-2xl border border-accent/40 bg-[linear-gradient(100deg,color-mix(in_srgb,var(--accent)_18%,var(--surface)),color-mix(in_srgb,var(--accent)_5%,var(--surface)))] px-4 py-3 shadow-[var(--shadow)] transition-[border-color,box-shadow,translate] duration-300 hover:-translate-y-0.5 hover:border-accent hover:shadow-[0_16px_34px_-24px_var(--brand-glow)]"
    >
      <Icon name="bulb" size={30} stroke={2} color="var(--accent)" />
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="text-[15px] font-extrabold">{text("home.tipsTitle")}</b>
        <span className="text-[12px] text-muted">{text("home.tipsSub")}</span>
      </span>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 transition-colors group-hover:bg-white/20">
        <Icon name="chevron" size={18} stroke={2.2} />
      </span>
    </a>
  );
}
