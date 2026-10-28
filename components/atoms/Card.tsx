import { cn } from "@/lib/cn";

/** The app's one card (UI/ design): rounded 16–20, hairline border, the surface colour.
 * `interactive` lifts on hover (a card that is a link); `glass` is the see-through card over a picture. */
export type CardVariant = "default" | "interactive" | "glass";

const VARIANT: Record<CardVariant, string> = {
  default: "border border-border bg-surface shadow-[var(--shadow)]",
  interactive: "border border-border bg-surface shadow-[var(--shadow)] transition-[border-color,translate,box-shadow] duration-300 hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-[0_18px_40px_-26px_var(--brand-glow)]",
  glass: "border border-white/15 bg-white/10 shadow-[0_18px_44px_-28px_rgba(0,0,0,.65)] backdrop-blur-md",
};

export function cardClass({ variant = "default", className }: { variant?: CardVariant; className?: string } = {}) {
  return cn("rounded-2xl", VARIANT[variant], className);
}

export function Card({ variant = "default", className = "", children, as: Tag = "div", ...rest }: { variant?: CardVariant; className?: string; children: React.ReactNode; as?: "div" | "section" | "article" | "li" | "nav" } & React.HTMLAttributes<HTMLElement>) {
  // its content keeps its own spacing; the default padding is the design's 16 (20 on computers)
  return (
    <Tag className={cardClass({ variant, className: cn("lux-enter block p-4 md:p-5", className) })} {...rest}>
      {children}
    </Tag>
  );
}
