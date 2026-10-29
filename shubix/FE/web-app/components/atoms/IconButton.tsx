import Link from "next/link";
import { cn } from "@/lib/cn";
import { Icon } from "./Icon";
import { iconButtonClass } from "@shubix/ui-web";

/** A round button with only an icon (back, menu, delete…): `label` is what screen readers say and the hover title.
 * `plain`: no border or fill. With `href` it is a link. */
type Props = { icon: string; label: string; size?: number; iconSize?: number; plain?: boolean; className?: string; title?: string };
const cls = (size: number, plain: boolean, className?: string) => cn(iconButtonClass(plain), className);

export function IconButton({ icon, label, size = 44, iconSize, plain = false, className, title, href, ...rest }: Props & ({ href: string } | ({ href?: undefined } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className" | "title">))) {
  const inner = <Icon name={icon} size={iconSize ?? Math.round(size * 0.45)} />;
  const style = { width: size, height: size };
  if (href) return <Link href={href} aria-label={label} title={title ?? label} className={cls(size, plain, className)} style={style}>{inner}</Link>;
  return <button type="button" aria-label={label} title={title ?? label} className={cls(size, plain, className)} style={style} {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}>{inner}</button>;
}
