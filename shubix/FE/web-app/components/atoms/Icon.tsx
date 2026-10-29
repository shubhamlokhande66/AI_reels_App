import { icons } from "@shubix/ui-web";

/** The line icons of the page designs (24 × 24, drawn with the current text colour): the shared list
 * (Shared/ui-core/src/icons.ts), so the phone app draws the same ones. */
export type { IconName } from "@shubix/ui-web";

export function Icon({ name, size = 20, stroke = 1.8, className, color }: { name: string; size?: number; stroke?: number; className?: string; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      aria-hidden="true"
      className={className}
      style={color ? { color } : undefined}
      dangerouslySetInnerHTML={{ __html: icons[name as keyof typeof icons] ?? icons.sparkle }}
    />
  );
}
