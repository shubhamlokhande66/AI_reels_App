import Link from "next/link";
import { cn } from "@/lib/cn";
import { Icon } from "./Icon";
import { SpinnerIcon } from "./Spinner";

/** The app's one button (UI/ design): the brand gradient for the main action, a quiet surface for the rest.
 * <Button> is a <button>; with `href` it is a link (`reload`: a full page load, e.g. Fast Studio).
 * `loading`: a spinner inside the button and no second click until the work is done (any button that starts a server
 * action also gets one by itself: lib/activity.ts). */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-bold transition-[filter,border-color,background-color,color,box-shadow,translate] duration-200 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:translate-y-px";
const VARIANT: Record<ButtonVariant, string> = {
  primary: "border border-transparent bg-gold text-on-accent shadow-[0_12px_26px_-14px_var(--brand-glow)] hover:brightness-110",
  secondary: "border border-border bg-surface text-foreground shadow-[var(--shadow)] hover:border-accent/60 hover:bg-surface-2",
  ghost: "border border-transparent bg-transparent text-foreground hover:bg-surface-2",
  danger: "border border-danger/35 bg-surface text-danger shadow-[var(--shadow)] hover:border-danger/70 hover:bg-danger/5",
};
const SIZE: Record<ButtonSize, string> = {
  sm: "h-9 rounded-[10px] px-3 text-[12px]",
  md: "h-10 rounded-xl px-3.5 text-[13px]",
  lg: "h-12 rounded-xl px-5 text-[14px]",
};

export function buttonClass({ variant = "primary", size = "md", full = false, className }: { variant?: ButtonVariant; size?: ButtonSize; full?: boolean; className?: string } = {}) {
  return cn(BASE, VARIANT[variant], SIZE[size], full && "w-full", className);
}

// the older string names (the admin's settings): the same classes as <Button>
export const btnPrimary = buttonClass();
export const btnSecondary = buttonClass({ variant: "secondary" });
export const btnDanger = buttonClass({ variant: "danger" });

type Common = { variant?: ButtonVariant; size?: ButtonSize; full?: boolean; icon?: string; iconRight?: string; loading?: boolean; className?: string; children?: React.ReactNode };
type AsButton = Common & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children"> & { href?: undefined };
type AsLink = Common & { href: string; reload?: boolean; onClick?: () => void; "aria-label"?: string; title?: string };

export function Button(props: AsButton | AsLink) {
  const { variant, size = "md", full, icon, iconRight, loading = false, className, children } = props;
  const cls = buttonClass({ variant, size, full, className });
  const iz = size === "lg" ? 22 : size === "sm" ? 16 : 18;
  const inner = (
    <>
      {loading ? <SpinnerIcon size={iz - 2} /> : icon && <Icon name={icon} size={iz} stroke={2.2} />}
      {children}
      {iconRight && <Icon name={iconRight} size={iz} stroke={2.2} />}
    </>
  );
  if (props.href !== undefined) {
    const { href, reload, onClick, title } = props;
    const Tag = reload ? "a" : Link;
    return (
      <Tag href={href} onClick={onClick} title={title} aria-label={props["aria-label"]} aria-busy={loading || undefined} className={cls}>
        {inner}
      </Tag>
    );
  }
  const { variant: _v, size: _s, full: _f, icon: _i, iconRight: _r, loading: _l, className: _c, children: _ch, type = "button", disabled, ...rest } = props;
  void _v; void _s; void _f; void _i; void _r; void _l; void _c; void _ch;
  return (
    <button type={type} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} data-loading={loading || undefined} {...rest}>
      {inner}
    </button>
  );
}

export function LinkButton({ href, children, primary = true, className = "" }: { href: string; children: React.ReactNode; primary?: boolean; className?: string }) {
  return (
    <Button href={href} variant={primary ? "primary" : "secondary"} className={className}>
      {children}
    </Button>
  );
}
