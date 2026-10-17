import Link from "next/link";

// The design's buttons (app/rm.css): gold for the main action, quiet surface for the rest.
export const btnPrimary = "btn g";
export const btnSecondary = "btn";
export const btnDanger = "btn danger";

export function LinkButton({ href, children, primary = true, className = "" }: { href: string; children: React.ReactNode; primary?: boolean; className?: string }) {
  return (
    <Link href={href} className={`${primary ? btnPrimary : btnSecondary} ${className}`}>
      {children}
    </Link>
  );
}
