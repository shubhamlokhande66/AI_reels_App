/** The website's segmented control (one of a few side by side: 9:16 / 4:5, Mix / In order), as Tailwind classes on
 * the row; its buttons need none of their own. Chosen: aria-pressed="true" on the button. `sm`: compact, one line. */
export const segClass = (sm = false) =>
  `inline-flex gap-[3px] rounded-[14px] border border-border bg-surface-2 p-[3px] *:rounded-[10px] *:font-semibold *:text-muted *:transition-colors *:aria-pressed:bg-[var(--chip-on)] *:aria-pressed:text-foreground *:aria-pressed:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_55%,transparent)] *:disabled:opacity-40 ${sm ? "flex-nowrap *:px-2.5 *:py-1.5 *:text-[12px]" : "flex-wrap *:px-3.5 *:py-[9px] *:text-[13px]"}`;
