/** The website's chip (a pill to pick one of a few: a tab, a filter, a style), as Tailwind classes for the React
 * <Chip> and the studio's HTML. Chosen: `on`, or aria-pressed="true" on the element. */
const BASE = "inline-flex h-[34px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border bg-surface px-3.5 text-[12.5px] font-semibold text-foreground transition-colors";
const OFF = "border-border hover:border-accent/50 aria-pressed:border-accent aria-pressed:bg-[var(--chip-on)]";

export const chipClass = (on = false) => `${BASE} ${on ? "border-accent bg-[var(--chip-on)]" : OFF}`;
