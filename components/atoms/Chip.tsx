import { cn } from "@/lib/cn";

/** A chip's look, for a link that is drawn as a chip. */
export const chipClass = (on = false, className?: string) =>
  cn("inline-flex h-[34px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border bg-surface px-3.5 text-[12.5px] font-semibold text-foreground transition-colors", on ? "border-accent bg-[var(--chip-on)]" : "border-border hover:border-accent/50", className);

/** A pill to pick one of a few (a tab, a filter, a style): `on` when chosen. */
export function Chip({ on = false, className, children, ...rest }: { on?: boolean; className?: string; children: React.ReactNode } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className">) {
  return (
    <button type="button" className={chipClass(on, className)} {...rest}>
      {children}
    </button>
  );
}

/** A row of chips that scrolls sideways (fading at the right edge on a phone); `wrap`: onto more lines instead. */
export function ChipRow({ wrap = false, className, children, ...rest }: { wrap?: boolean; className?: string; children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex gap-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", wrap ? "flex-wrap" : "flex-nowrap overflow-x-auto max-md:pr-7 max-md:[mask-image:linear-gradient(to_right,#000_calc(100%-28px),transparent)]", className)} {...rest}>
      {children}
    </div>
  );
}
