/** The website's one button, as Tailwind classes: the React atoms (<Button>, <IconButton>) and the studio's HTML use
 * these, so every button looks the same. primary: the brand gradient for the main action; secondary: a quiet surface;
 * ghost: no fill; danger: red. */
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

export const buttonClass = ({ variant = "primary", size = "md", full = false }: { variant?: ButtonVariant; size?: ButtonSize; full?: boolean } = {}) =>
  [BASE, VARIANT[variant], SIZE[size], full && "w-full"].filter(Boolean).join(" ");

/** A round button with only an icon (back, undo, send…); its size is set where it is used. box: bordered surface;
 * plain: no border or fill (muted: grey); main: the brand gradient (send, apply). */
const ICON_LOOK = { box: "border border-border bg-surface text-foreground hover:text-accent", plain: "border-0 bg-transparent text-foreground hover:text-accent", muted: "border-0 bg-transparent text-muted hover:text-foreground", main: "border-0 bg-gold text-on-accent hover:brightness-110" };
export const iconButtonClass = (look: keyof typeof ICON_LOOK = "box") =>
  `grid shrink-0 place-items-center rounded-full p-0 transition-[color,filter] disabled:opacity-50 ${ICON_LOOK[look]}`;
