import { cn } from "@/lib/cn";

/** A person's first letter on the brand gradient (the menu, the account page). */
export function Avatar({ email, size = 36, className }: { email?: string | null; size?: number; className?: string }) {
  return (
    <span aria-hidden className={cn("grid shrink-0 place-items-center rounded-full font-extrabold text-on-accent [background:var(--gold-gradient)]", className)} style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {(email?.[0] ?? "R").toUpperCase()}
    </span>
  );
}
