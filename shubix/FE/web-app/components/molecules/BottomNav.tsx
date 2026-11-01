"use client";

import Link from "next/link";
import { Icon } from "@/components/atoms/Icon";
import { cn } from "@/lib/cn";

export type NavTab = { href: string; label: string; icon: string; primary?: boolean; full?: boolean; active?: boolean };

/** The phones' bottom bar (UI/ design: Bottom Navigation): Home, Templates, the raised Create button, My Reels and Account (the menu opens from the top bar).
 * The open tab is purple with a line under its name. `full`: a full page load (Fast Studio). */
export function BottomNav({ tabs }: { tabs: NavTab[] }) {
  const item = "relative flex min-h-[52px] flex-col items-center justify-end gap-1 pb-1 text-[11px] font-semibold transition-colors";
  const mark = (on: boolean) => on && <span aria-hidden className="absolute -bottom-0.5 h-[3px] w-7 rounded-full bg-accent" />;
  return (
    <nav
      aria-label="Quick"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 items-end rounded-t-[22px] border-t border-border bg-[var(--bar)] px-1 pb-[max(14px,env(safe-area-inset-bottom))] pt-2 md:hidden"
    >
      {tabs.map((t) => {
        const Tag = t.full ? "a" : Link;
        if (t.primary)
          return (
            <Tag key={t.href} href={t.href} aria-label={t.label} className={cn(item, "text-foreground")}>
              <span className="-mt-8 grid h-[60px] w-[60px] place-items-center rounded-full border-4 border-background bg-gold text-on-accent shadow-[0_10px_24px_-8px_var(--brand-glow)]">
                <Icon name="plus" size={26} stroke={2.4} />
              </span>
              {t.label}
            </Tag>
          );
        return (
          <Tag key={t.href} href={t.href} aria-current={t.active ? "page" : undefined} className={cn(item, t.active ? "text-accent" : "text-muted hover:text-foreground")}>
            <Icon name={t.icon} size={23} stroke={t.active ? 2.2 : 1.8} />
            {t.label}
            {mark(!!t.active)}
          </Tag>
        );
      })}
    </nav>
  );
}
