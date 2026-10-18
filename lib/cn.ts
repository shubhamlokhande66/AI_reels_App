/** Joins Tailwind class names, leaving out the empty ones: cn("px-4", busy && "opacity-50", className). */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
