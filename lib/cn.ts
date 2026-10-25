import { twMerge } from "tailwind-merge";

/** Joins Tailwind class names, leaving out the empty ones; a later class wins over an earlier one of the same kind
 * (cn("p-4 block", "p-2 flex") is "p-2 flex"), so a page can change a shared atom's look: cn("px-4", busy && "opacity-50", className). */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return twMerge(parts.filter(Boolean).join(" "));
}
