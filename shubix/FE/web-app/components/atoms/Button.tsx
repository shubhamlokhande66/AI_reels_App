import Link from "next/link";
import { cn } from "@/lib/cn";
import { Icon } from "./Icon";
import { SpinnerIcon } from "./Spinner";
import { buttonClass as shared, type ButtonVariant, type ButtonSize } from "@shubix/ui-web";

/** The app's one button (UI/ design): the brand gradient for the main action, a quiet surface for the rest.
 * <Button> is a <button>; with `href` it is a link (`reload`: a full page load, e.g. Fast Studio).
 * `loading`: a spinner inside the button and no second click until the work is done (any button that starts a server
 * action also gets one by itself: lib/activity.ts). */
export type { ButtonVariant, ButtonSize };
export function buttonClass({ className, ...o }: { variant?: ButtonVariant; size?: ButtonSize; full?: boolean; className?: string } = {}) {
  return cn(shared(o), className);
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
