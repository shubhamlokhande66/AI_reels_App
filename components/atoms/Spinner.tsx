import { cn } from "@/lib/cn";

/** The app's one loader (a ring in the brand colour). Every wait looks the same:
 * <Spinner /> while a page or a section loads (centred, with a short line); <SpinnerIcon /> inside a button or a row. */
export function SpinnerIcon({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent opacity-90", className)}
      style={{ width: size, height: size }}
    />
  );
}

export function Spinner({ label = "Loading…", size = "md", className }: { label?: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const ring = size === "lg" ? 44 : size === "sm" ? 22 : 34;
  return (
    <div role="status" aria-live="polite" className={cn("flex w-full flex-col items-center justify-center gap-3 text-center", size === "sm" ? "py-4" : "min-h-[30vh] py-10", className)}>
      <span className="relative inline-grid place-items-center" style={{ width: ring, height: ring }} aria-hidden>
        <span className="absolute inset-0 rounded-full border-[3px] border-accent/15" />
        <span className="absolute inset-0 animate-spin rounded-full border-[3px] border-transparent border-t-accent border-r-accent-hover" />
      </span>
      {label && <span className="text-sm font-semibold text-muted">{label}</span>}
    </div>
  );
}

/** A grey shape that shimmers where content is still coming (cards, rows, pictures). */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn("block animate-pulse rounded-xl bg-surface-2", className)} />;
}
