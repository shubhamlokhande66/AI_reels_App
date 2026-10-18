import { Badge } from "@/components/atoms/Badge";
import { Button } from "@/components/atoms/Button";
import { Icon } from "@/components/atoms/Icon";
import { IconTile } from "@/components/atoms/IconTile";
import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/ui";
import type { Pricing } from "@/types/api";

export type Plan = Pricing["plans"][number];
export const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;

// each plan's own icon and tone (unknown plans from the administrator's pricing get the last one)
const LOOK: Record<string, { icon: string; tone: Tone }> = {
  free: { icon: "sparkle", tone: "talk" },
  creator: { icon: "bolt", tone: "music" },
  pro: { icon: "crown", tone: "photo" },
  business: { icon: "bag", tone: "recreate" },
};

/** One plan (Pricing page): its name and line, the price for the chosen period, the credits, the button, and
 * everything it includes. The popular one stands out: a gradient edge, a glow and the "Most popular" badge. */
export function PlanCard({ plan, yearly, action }: { plan: Plan; yearly: boolean; action: React.ReactNode }) {
  const free = plan.monthly === 0;
  const pop = plan.highlight;
  const price = free ? 0 : yearly ? plan.yearly : plan.monthly;
  const perMonth = yearly && !free ? Math.round(plan.yearly / 12) : null;
  const look = LOOK[plan.id] ?? { icon: "star", tone: "brand" as Tone };
  return (
    <article
      className={cn(
        "relative flex min-w-0 flex-col gap-5 rounded-3xl p-6",
        pop
          ? "border-2 border-transparent shadow-[0_28px_60px_-30px_var(--brand-glow)] [background:linear-gradient(var(--surface),var(--surface))_padding-box,var(--gold-gradient)_border-box] lg:-translate-y-3"
          : "border border-border bg-surface shadow-[var(--shadow)]",
      )}
    >
      {pop && <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-3.5 py-1 text-[11.5px] font-extrabold uppercase tracking-wider text-white [background:var(--gold-gradient)]">Most popular</span>}

      <header className="flex items-center gap-3">
        <IconTile icon={look.icon} tone={look.tone} size={44} />
        <div className="min-w-0">
          <h3 className="m-0 font-[family-name:var(--font-display)] text-[19px] font-extrabold leading-tight">{plan.name}</h3>
          <p className="m-0 text-[13px] leading-snug text-muted">{plan.tagline}</p>
        </div>
      </header>

      <div className="flex flex-col gap-1">
        <p className="m-0 flex items-baseline gap-1">
          <span className="font-[family-name:var(--font-display)] text-[40px] font-extrabold leading-none tracking-[-0.03em] tabular-nums">{rupees(price)}</span>
          {!free && <span className="text-[14px] font-semibold text-muted">/{yearly ? "year" : "month"}</span>}
        </p>
        <p className="m-0 h-5 text-[12.5px] text-muted">{free ? "Free forever" : perMonth ? `${rupees(perMonth)} a month, billed yearly` : "Billed monthly · nothing renews by itself"}</p>
      </div>

      <Badge tone={pop ? "brand" : "neutral"} className="h-8 self-start px-3 text-[12.5px]">
        <Icon name="bolt" size={15} stroke={2.2} />
        {plan.credits.toLocaleString("en-IN")} credits {plan.creditsNote}
      </Badge>

      {action}

      <ul className="m-0 flex list-none flex-col gap-2.5 border-t border-border p-0 pt-5">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-[13.5px] leading-snug">
            <span className={cn("mt-px grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full", pop ? "bg-accent text-white" : "bg-accent/15 text-accent")}>
              <Icon name="check" size={11} stroke={3} />
            </span>
            {f}
          </li>
        ))}
      </ul>
    </article>
  );
}

/** The plan's button, as far as this person and this studio allow (sign in, payments not open yet, your plan…). */
export function PlanAction({ plan, signedIn, paymentsOpen, current, busy, onBuy }: { plan: Plan; signedIn: boolean; paymentsOpen: boolean; current: boolean; busy: boolean; onBuy: () => void }) {
  const variant = plan.highlight ? "primary" : "secondary";
  if (plan.monthly === 0) return <Button href={signedIn ? "/" : "/login"} variant="secondary" full>{signedIn ? "Make a Reel" : "Start free"}</Button>;
  if (!paymentsOpen) return <Button variant={variant} full disabled title="Online payment opens soon">{current ? "Your current plan" : "Opens soon"}</Button>;
  if (!signedIn) return <Button href="/login" variant={variant} full>Sign in to choose {plan.name}</Button>;
  return (
    <Button variant={variant} full loading={busy} onClick={onBuy} iconRight={busy ? undefined : "send"}>
      {busy ? "Opening payment…" : current ? `Extend ${plan.name}` : `Choose ${plan.name}`}
    </Button>
  );
}
