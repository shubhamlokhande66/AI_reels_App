import { cn } from "@/lib/cn";

/** A small spaced-out label above a heading or a group ("STUDIO", "ADMIN ONLY"). */
export function Eyebrow({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn("text-[11px] font-bold uppercase tracking-[0.2em] text-muted", className)}>{children}</span>;
}
