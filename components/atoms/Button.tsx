import Link from "next/link";

const BTN = "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold tracking-wide transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-45";
export const btnPrimary = `${BTN} lux-btn-gold`;
export const btnSecondary = `${BTN} border border-border bg-surface-2/70 text-foreground hover:border-accent/60 hover:text-accent`;
export const btnDanger = `${BTN} border border-danger/40 text-danger hover:bg-danger/10`;

export function LinkButton({ href, children, primary = true }: { href: string; children: React.ReactNode; primary?: boolean }) {
  return (
    <Link href={href} className={primary ? btnPrimary : btnSecondary}>
      {children}
    </Link>
  );
}
