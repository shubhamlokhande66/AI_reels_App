"use client";

import Link from "next/link";
import { Icon } from "@/components/atoms/Icon";
import { useText } from "@/hooks/useApi";

/** A section's title with its "See All ›" link (UI/ design). */
export function SectionHeader({ title, href, more, id }: { title: string; href?: string; more?: string; id?: string }) {
  const text = useText();
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 id={id} className="m-0 font-[family-name:var(--font-display)] text-[17px] font-semibold tracking-[-0.01em] text-foreground md:text-[19px]">
        {title}
      </h2>
      {href && (
        <Link href={href} className="inline-flex shrink-0 items-center gap-0.5 text-[13px] font-semibold text-muted transition-colors hover:text-foreground">
          {more ?? text("home.seeAll")}
          <Icon name="chevron" size={16} stroke={2.2} />
        </Link>
      )}
    </div>
  );
}

/** A row that scrolls sideways on a phone (snap to each card), inside the page's side padding; `grid` makes it a
 * grid from tablets up. */
export function Scroller({ label, children, grid = "" }: { label: string; children: React.ReactNode; grid?: string }) {
  return (
    <section aria-label={label} className={`flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 ${grid}`} style={{ scrollbarWidth: "none" }}>
      {children}
    </section>
  );
}
