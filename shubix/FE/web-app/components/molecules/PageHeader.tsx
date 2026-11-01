"use client";

import { TopAction, useIsDesktop } from "@/components/templates/TopBar";
import { Heading } from "@/components/atoms/Heading";

/** A page's heading, as designed. On a phone the title sits in the top bar, so only the line under it shows here and
 * the action moves to the top bar's corner; on a computer the title, the line and the action sit together.
 * `desktopOnly`: the action is for computers only; on a phone the top bar keeps its plan pill and bell. */
export function PageHeader({ title, subtitle, action, desktopOnly = false }: { title: string; subtitle?: string; action?: React.ReactNode; desktopOnly?: boolean }) {
  const desktop = useIsDesktop();
  if (desktopOnly && !desktop) action = undefined;
  return (
    <div className="md:mb-3">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Heading size="page" className="hidden md:block">{title}</Heading>
          {subtitle && <p className="m-0 text-[13.5px] leading-[1.45] text-muted md:mt-1">{subtitle}</p>}
        </div>
        {action && (
          <div className="flex shrink-0 items-center gap-2 empty:hidden">
            <TopAction>{action}</TopAction>
          </div>
        )}
      </div>
    </div>
  );
}

/** A page's own big heading, shown on phones too (Story, Editor, Contact, Pricing). */
export function Hero({ title, subtitle, center = false }: { title: string; subtitle?: string; center?: boolean }) {
  return (
    <div className={center ? "text-center" : ""}>
      <Heading size="page" className="text-[clamp(24px,5.5vw,32px)] md:text-[clamp(24px,5.5vw,32px)]">{title}</Heading>
      {subtitle && <p className="m-0 mt-1 text-[13.5px] leading-[1.45] text-muted">{subtitle}</p>}
    </div>
  );
}
