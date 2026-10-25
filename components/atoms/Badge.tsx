import { cn } from "@/lib/cn";

/** A small pill: a status, a plan, a duration on a picture ("15s"). */
export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger" | "dark";

const TONE: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-muted",
  brand: "bg-accent/15 text-accent",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/15 text-danger",
  dark: "border border-white/25 bg-black/65 text-white", // over a picture (no blur: over a playing video it would be redone every frame)
};

export function Badge({ tone = "neutral", className, children }: { tone?: BadgeTone; className?: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[11px] font-bold tabular-nums", TONE[tone], className)}>{children}</span>;
}
