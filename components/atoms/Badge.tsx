import { cn } from "@/lib/cn";

/** A small pill: a status, a plan, a duration on a picture ("15s"). */
export type BadgeTone = "neutral" | "brand" | "success" | "danger" | "dark";

const TONE: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-muted",
  brand: "bg-accent/15 text-accent",
  success: "bg-success/15 text-success",
  danger: "bg-danger/15 text-danger",
  dark: "border border-white/25 bg-black/55 text-white backdrop-blur-sm", // over a picture
};

export function Badge({ tone = "neutral", className, children }: { tone?: BadgeTone; className?: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[11px] font-bold tabular-nums", TONE[tone], className)}>{children}</span>;
}
