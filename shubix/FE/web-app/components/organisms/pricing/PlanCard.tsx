"use client";

import { Button } from "@/components/atoms/Button";
import { Icon } from "@/components/atoms/Icon";
import { IconTile } from "@/components/atoms/IconTile";
import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/ui";
import type { Pricing } from "@/types/api";
import { useText } from "@/hooks/useApi";

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
 * everything it includes. A tap selects a plan: the selected one stands out (a gradient edge, a glow, a check); the
 * popular one carries the "Most popular" badge. */
export function PlanCard({ plan, yearly, action, selected, onSelect, offer }: { plan: Plan; yearly: boolean; action: React.ReactNode; selected: boolean; onSelect: () => void; offer?: number }) {
  const free = plan.monthly === 0;
  const pop = plan.highlight;
  const price = free ? 0 : yearly ? plan.yearly : plan.monthly;
  const perMonth = yearly && !free ? Math.round(plan.yearly / 12) : null;
  const look = LOOK[plan.id] ?? { icon: "star", tone: "brand" as Tone };
  const text = useText();
  return (
    <article
      aria-label={`${plan.name}${selected ? " (selected)" : ""}`}
      onClick={onSelect}
      onFocus={onSelect} // a keyboard reaching its button selects it too
      className={cn(
        "relative flex min-w-0 cursor-pointer flex-col gap-5 rounded-3xl border-2 p-6 transition-[transform,box-shadow,border-color] duration-200 lg:p-5 xl:p-6",
        selected
          ? "border-transparent shadow-[0_28px_60px_-30px_var(--brand-glow)] [background:linear-gradient(var(--surface),var(--surface))_padding-box,var(--gold-gradient)_border-box] lg:-translate-y-3"
          : "border-border bg-surface shadow-[var(--shadow)] hover:-translate-y-0.5 hover:border-accent/40",
      )}
    >
      {selected && (
        <span aria-hidden className="absolute right-4 top-4 grid h-6 w-6 place-items-center text-on-accent [background:var(--gold-gradient)] shadow-[0_6px_14px_-6px_var(--brand-glow)]">
          <Icon name="check" size={13} stroke={3} />
        </span>
      )}
      {pop && <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-3.5 py-1 text-[11.5px] font-extrabold uppercase tracking-wider text-on-accent [background:var(--gold-gradient)]">{text("pricing.popular")}</span>}

      <header className="flex items-center gap-3 pr-7">
        <IconTile icon={look.icon} tone={look.tone} size={44} />
        <div className="min-w-0">
          <h3 className="m-0 font-[family-name:var(--font-display)] text-[17px] font-semibold leading-tight">{plan.name}</h3>
          <p className="m-0 text-[13px] leading-snug text-muted">{plan.tagline}</p>
        </div>
      </header>

      <div className="flex flex-col gap-1">
        {/* a sale running (Admin → Marketing → Offers): the price after it, the old one struck through */}
        {offer && !free ? (
            <span className="mb-1 inline-flex w-fit items-center gap-1 rounded-full bg-gold px-2.5 py-0.5 text-[11px] font-bold text-on-accent">{text("pricing.offerTag", { percent: offer })}</span>
        ) : null}
        <p className="m-0 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-[family-name:var(--font-display)] text-[34px] font-bold leading-none tracking-[-0.03em] tabular-nums">{rupees(offer && !free ? Math.round((price * (100 - offer)) / 100) : price)}</span>
          {offer && !free ? <s className="text-[16px] font-semibold text-muted tabular-nums">{rupees(price)}</s> : null}
          {!free && <span className="text-[14px] font-semibold text-muted">{text(yearly ? "pricing.perYear" : "pricing.perMonth")}</span>}
        </p>
        <p className="m-0 h-5 text-[12.5px] text-muted">{free ? text("pricing.freeForever") : perMonth ? text("pricing.billedYearly", { price: rupees(perMonth) }) : text("pricing.billedMonthly")}</p>
      </div>

      {/* the credits, wrapping on a narrow card (never past its edge) */}
      <p className={cn("m-0 flex items-start gap-2 rounded-xl px-3 py-2 text-[12.5px] leading-snug", selected ? "bg-accent/10 text-foreground" : "bg-surface-2 text-muted")}>
        <Icon name="bolt" size={15} stroke={2.2} color="var(--accent)" className="mt-px shrink-0" />
        <span className="min-w-0">
          {plan.credits > 0 && <b className="font-extrabold text-foreground">{plan.credits.toLocaleString("en-IN")} {text("pricing.credits")} </b>}
          {plan.credits > 0 ? plan.creditsNote : plan.creditsNote.replace(/^./, (c) => c.toUpperCase())}
        </span>
      </p>

      {action}

      <ul className="m-0 flex list-none flex-col gap-2.5 border-t border-border p-0 pt-5">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-[13.5px] leading-snug">
            <span className={cn("mt-px grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full", selected ? "bg-accent text-on-accent" : "bg-accent/15 text-accent")}>
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
export function PlanAction({ plan, signedIn, paymentsOpen, current, busy, selected, onBuy }: { plan: Plan; signedIn: boolean; paymentsOpen: boolean; current: boolean; busy: boolean; selected: boolean; onBuy: () => void }) {
  const text = useText();
  const variant = selected ? "primary" : "secondary";
  if (plan.monthly === 0) return <Button href={signedIn ? "/" : "/login"} variant="secondary" full>{text(signedIn ? "pricing.makeReel" : "pricing.startFree")}</Button>;
  if (!paymentsOpen) return <Button variant={variant} full disabled title={text("pricing.soon")}>{text(current ? "pricing.currentPlan" : "pricing.opensSoon")}</Button>;
  if (!signedIn) return <Button href="/login" variant={variant} full>{text("pricing.signInFor", { plan: plan.name })}</Button>;
  return (
    <Button variant={variant} full loading={busy} onClick={onBuy} iconRight={busy ? undefined : "send"}>
      {busy ? text("pricing.opening") : text(current ? "pricing.extend" : "pricing.choose", { plan: plan.name })}
    </Button>
  );
}
