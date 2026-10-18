import { Button } from "@/components/atoms/Button";
import { Icon } from "@/components/atoms/Icon";
import { cn } from "@/lib/cn";

/** "Go Pro with Shubix" (UI/ design): the plans. `compact`: the sidebar's small card (stacked, a full-width button). */
export function ProBanner({ href = "/pricing", compact = false }: { href?: string; compact?: boolean }) {
  return (
    <section
      aria-label="Go Pro"
      className={cn(
        "relative flex overflow-hidden rounded-2xl border border-accent/50 bg-[linear-gradient(100deg,rgba(176,92,255,.22),rgba(91,76,245,.12))]",
        compact ? "flex-col gap-2.5 p-3.5" : "items-center gap-3 p-4 md:gap-4 md:p-5",
      )}
    >
      <span aria-hidden className="pointer-events-none absolute -right-5 -top-6 text-[#f0abfc] opacity-15">
        <Icon name="crown" size={compact ? 70 : 96} />
      </span>
      <span className={cn("flex min-w-0 gap-3", compact ? "items-center" : "flex-1 items-center md:gap-4")}>
        <span className={cn("grid shrink-0 place-items-center text-[#f0abfc]", compact ? "h-8 w-8" : "h-12 w-12")}>
          <Icon name="crown" size={compact ? 26 : 34} />
        </span>
        <span className="flex min-w-0 flex-col">
          <b className={cn("font-extrabold", compact ? "text-[14px]" : "text-[15px] md:text-lg")}>{compact ? "Upgrade to Pro" : "Go Pro with Shubix"}</b>
          <span className={cn("leading-snug text-muted", compact ? "text-[11.5px]" : "text-[12px] md:text-[13px]")}>
            {compact ? "Premium templates & AI edits" : "More templates, premium styles and advanced AI edits."}
          </span>
        </span>
      </span>
      <Button href={href} size="sm" iconRight="send" full={compact} className={compact ? "" : "shrink-0"}>
        Upgrade
      </Button>
    </section>
  );
}
