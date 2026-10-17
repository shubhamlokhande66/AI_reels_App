"use client";

import { TopAction } from "@/components/templates/TopBar";

/** A page's heading, as designed. On a phone the title sits in the top bar, so only the line under it shows here and
 * the action moves to the top bar's corner; on a computer the serif title, the line and the action sit together. */
export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 md:mb-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="h1 hidden md:block">{title}</h1>
          {subtitle && <p className="sub !mt-0 md:!mt-1">{subtitle}</p>}
        </div>
        {action && (
          <div className="flex shrink-0 items-center gap-2">
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
      <h1 className="h1" style={{ fontSize: "clamp(28px, 7vw, 40px)" }}>
        {title}
      </h1>
      {subtitle && <p className="sub">{subtitle}</p>}
    </div>
  );
}
