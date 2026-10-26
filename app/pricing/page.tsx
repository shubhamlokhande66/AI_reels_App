"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { useCredits, useList, useMe, useT } from "@/hooks/useApi";
import { pay } from "@/lib/razorpay";
import { cn } from "@/lib/cn";
import type { Credits } from "@/types/api";
import { Badge, Button, Card, Icon, Spinner } from "@/components/atoms";
import { ErrorBanner } from "@/components/molecules";
import { SectionHeading } from "@/components/molecules/SectionHeading";
import { PlanAction, PlanCard, rupees } from "@/components/organisms/pricing/PlanCard";
import { Checkout } from "@/components/organisms/pricing/Checkout";
import { OfferStrip } from "@/components/molecules/OfferStrip";
import { PlanCompare } from "@/components/organisms/pricing/PlanCompare";

const day = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");


function MyCredits({ c }: { c: Extract<Credits, { enabled: true }> }) {
  const t = useT();
  return (
    <Card as="section" aria-label={t("pricing.yourCredits")} className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-[13px] font-semibold text-muted">{t("pricing.yourCredits")}</span>
          <span className="flex items-center gap-2 font-[family-name:var(--font-display)] text-[28px] font-semibold leading-tight tabular-nums">
            <Icon name="bolt" size={26} stroke={2.2} color="#6d8bff" />
            {c.balance.toLocaleString("en-IN")}
          </span>
        </div>
        <Badge tone="brand" className="h-8 px-3 text-[12.5px]">
          <Icon name="crown" size={14} />
          {t("pricing.planBadge", { plan: c.planName })}
        </Badge>
      </div>
      <p className="m-0 text-[12.5px] text-muted">
        {c.plan !== "free" && c.planEnds ? `${t("pricing.activeUntil", { date: day(c.planEnds) })} · ` : ""}
        {c.plan !== "free" && c.renews ? `${t("pricing.renews", { date: day(c.renews) })} · ` : ""}
        {c.extra > 0 ? t("pricing.extraLeft", { n: c.extra.toLocaleString("en-IN") }) : c.plan === "free" ? t("pricing.freeNote") : ""}
      </p>
      {c.history.length > 0 && (
        <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
          {c.history.slice(0, 5).map((h, i) => (
            <li key={i} className="flex items-center justify-between gap-3 py-2 text-[13px]">
              <span className="min-w-0 truncate text-muted">{h.reason}</span>
              <span className={cn("shrink-0 font-bold tabular-nums", h.delta > 0 && "text-success")}>
                {h.delta > 0 ? `+${h.delta.toLocaleString("en-IN")}` : h.delta < 0 ? `−${Math.abs(h.delta).toLocaleString("en-IN")}` : "0"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Plans and credits. Open to everyone (also before signing in); signed-in users can buy and see their credits. */
export default function PricingPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["plans"], queryFn: api.plans, staleTime: 300_000 });
  const me = useMe();
  const credits = useCredits();
  const t = useT();
  const faq = useList("pricing.faq"); // the questions: Admin → CMS → Pricing → Questions
  const [yearly, setYearly] = useState(false);
  const [buying, setBuying] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null); // the plan card tapped (until then: your plan, or the popular one)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [checkout, setCheckout] = useState<{ item: string; label: string } | null>(null); // "Your order": the price, the offer, a coupon
  const offer = useQuery({ queryKey: ["offer"], queryFn: api.offer, staleTime: 60_000 }).data?.offer ?? null;
  const signedIn = !!me.data?.user || me.data?.authEnabled === false;
  const mine = credits.data?.enabled ? credits.data : null;

  function buy(item: string, label: string) { setNotice(null); setCheckout({ item, label }); }
  async function payNow(item: string, label: string, coupon?: string) {
    setNotice(null);
    setBuying(item);
    try {
      const r = await pay(item, { name: t("checkout.name"), logo: t("checkout.logo"), color: t("checkout.color") }, coupon);
      if (r.status !== "closed") setCheckout(null);
      if (r.status === "paid") {
        qc.setQueryData(["credits"], r.credits);
        setNotice({ ok: true, text: t("pricing.paid", { item: label }) });
      } else if (r.status === "failed") {
        setNotice({ ok: false, text: r.message });
      }
    } catch (e) {
      setNotice({ ok: false, text: errorMessage(e) });
    } finally {
      setBuying(null);
    }
  }

  if (q.isLoading) return <Spinner label="Loading plans…" />;
  if (q.error || !q.data) return <ErrorBanner message={errorMessage(q.error ?? new Error("Plans are not available."))} onRetry={() => void q.refetch()} />;
  const p = q.data;
  const period = yearly ? "yearly" : "monthly";
  const freeMonths = 12 - p.yearlyMonthsCharged;
  const shown = p.plans.filter((x) => !x.hidden);
  const selectedId = picked ?? (mine && mine.plan !== "free" && shown.some((x) => x.id === mine.plan) ? mine.plan : shown.find((x) => x.highlight)?.id ?? shown[0]?.id);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 pb-4 md:gap-16">
      {/* the hero: what it costs, in one line */}
      <header className="relative flex flex-col items-center gap-4 pt-4 text-center md:pt-8">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-10 -z-10 mx-auto h-64 max-w-3xl rounded-full bg-[radial-gradient(closest-side,rgba(176,92,255,.28),transparent)] blur-2xl" />
        <Badge tone="brand" className="h-8 px-3.5 text-[12.5px] uppercase tracking-wider">
          <Icon name="coins" size={15} />
          {t("pricing.badge")}
        </Badge>
        <h1 className="m-0 max-w-3xl font-[family-name:var(--font-display)] text-[clamp(28px,5.5vw,44px)] font-semibold leading-[1.08] tracking-[-0.025em]">
          {t("pricing.title1")} <span className="bg-[linear-gradient(90deg,#c084fc,#e040fb_55%,#ff4fd8)] bg-clip-text text-transparent">{t("pricing.title2")}</span>
        </h1>
        <p className="m-0 max-w-xl text-[15.5px] leading-relaxed text-muted md:text-[17px]">{t("pricing.sub", { aiCost: p.costs.studio_ai ?? 10 })}</p>

        {/* Monthly / Yearly */}
        <div role="radiogroup" aria-label="Billing period" className="mt-2 inline-flex items-center gap-1 rounded-full border border-border bg-surface p-1.5 shadow-[var(--shadow)]">
          {([false, true] as const).map((y) => (
            <button
              key={String(y)}
              type="button"
              role="radio"
              aria-checked={yearly === y}
              onClick={() => setYearly(y)}
              className={cn(
                "inline-flex h-10 items-center gap-2 rounded-full px-5 text-[14px] font-bold transition-colors",
                yearly === y ? "text-white [background:var(--gold-gradient)] shadow-[0_8px_20px_-10px_var(--brand-glow)]" : "text-muted hover:text-foreground",
              )}
            >
              {t(y ? "pricing.yearly" : "pricing.monthly")}
              {y && freeMonths > 0 && (
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-extrabold", yearly ? "bg-white/20 text-white" : "bg-success/15 text-[color-mix(in_srgb,var(--success)_75%,var(--foreground))]")}>
                  {t("pricing.monthsFree", { n: freeMonths })}
                </span>
              )}
            </button>
          ))}
        </div>
      </header>

      {offer && <OfferStrip offer={offer} />}

      <Checkout item={checkout?.item ?? null} label={checkout?.label ?? ""} busy={!!checkout && buying === checkout.item}
        onClose={() => setCheckout(null)} onPay={(coupon) => checkout && void payNow(checkout.item, checkout.label, coupon)} />

      {notice && (
        <p role="status" className={cn("m-0 -mt-6 flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-center text-[14px] font-semibold", notice.ok ? "border-success/40 bg-success/10 text-success" : "border-danger/40 bg-danger/10 text-danger")}>
          <Icon name={notice.ok ? "check" : "warn"} size={18} stroke={2.2} />
          {notice.text}
        </p>
      )}

      {/* the plans */}
      <section aria-label="Plans" className={cn("mx-auto grid w-full gap-5 lg:max-w-none lg:gap-4", p.plans.filter((x) => !x.hidden).length === 3 ? "max-w-md lg:grid-cols-3" : "max-w-3xl sm:grid-cols-2 2xl:grid-cols-4")}>
        {p.plans.filter((x) => !x.hidden).map((plan) => {
          const item = `plan:${plan.id}:${period}`;
          const current = !!mine && mine.plan === plan.id && plan.id !== "free";
          return (
            <PlanCard
              key={plan.id}
              plan={plan}
              yearly={yearly}
              selected={plan.id === selectedId}
              onSelect={() => setPicked(plan.id)}
              offer={offer && offer.appliesTo !== "topups" ? offer.percent : undefined}
              action={
                <PlanAction
                  plan={plan}
                  signedIn={signedIn}
                  paymentsOpen={p.paymentsOpen}
                  current={current}
                  busy={buying === item}
                  selected={plan.id === selectedId}
                  onBuy={() => void buy(item, `${plan.name} (${yearly ? "1 year" : "1 month"})`)}
                />
              }
            />
          );
        })}
      </section>

      <PlanCompare t={t} plans={p.plans.filter((x) => !x.hidden).map((x) => x.id)} />

      {/* your credits and top-ups */}
      <section aria-label="Credits" className={cn("grid gap-5", mine && "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]")}>
        {mine && <MyCredits c={mine} />}
        <Card as="section" aria-label="Top up" className="flex flex-col gap-4">
          <SectionHeading title={t("pricing.topUpTitle")} sub={t("pricing.topUpSub")} />
          <div className="grid gap-3 sm:grid-cols-2">
            {p.topUps.map((tu) => {
              const item = `topup:${tu.id}`;
              return (
                <div key={tu.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface-2 p-4">
                  <div className="flex flex-col">
                    <span className="flex items-center gap-1.5 font-[family-name:var(--font-display)] text-[20px] font-semibold tabular-nums">
                      <Icon name="bolt" size={18} stroke={2.2} color="#6d8bff" />+{tu.credits.toLocaleString("en-IN")}
                    </span>
                    <span className="text-[12px] text-muted">{t("pricing.perCredit", { price: rupees(Math.round((tu.price / tu.credits) * 10) / 10) })}</span>
                  </div>
                  <Button size="sm" variant="secondary" loading={buying === item} disabled={!p.paymentsOpen || !signedIn || (buying !== null && buying !== item)} title={!p.paymentsOpen ? t("pricing.soon") : undefined} onClick={() => void buy(item, `${tu.credits} ${t("pricing.credits")}`)}>
                    {offer && offer.appliesTo !== "plans" ? <><s className="mr-1 opacity-60">{rupees(tu.price)}</s>{rupees(Math.round((tu.price * (100 - offer.percent)) / 100))}</> : rupees(tu.price)}
                  </Button>
                </div>
              );
            })}
          </div>
        </Card>
      </section>

      {/* what a credit buys */}
      <section aria-labelledby="costs-h" className="flex flex-col gap-5">
        <SectionHeading id="costs-h" title={t("pricing.costsTitle")} sub={t("pricing.costsSub")} center />
        <Card className="!p-2 md:!p-3">
          <ul className="m-0 grid list-none gap-x-6 p-0 lg:grid-cols-2">
            {p.creditCosts.filter((c) => c.id.startsWith("studio_") || c.credits > 0).filter((c) => !["clip_reel", "version", "story_render", "preview"].includes(c.id)).map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 border-b border-border px-3 py-3.5 last:border-b-0 lg:[&:nth-last-child(2):nth-child(odd)]:border-b-0">
                <span className="flex min-w-0 items-center gap-2.5 text-[14px] font-semibold">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/12 text-accent">
                    <Icon name={c.credits === 0 ? "sparkle" : "bolt"} size={15} stroke={2} />
                  </span>
                  <span className="min-w-0">{c.action}</span>
                </span>
                <Badge tone={c.credits === 0 ? "success" : "brand"} className="h-7 shrink-0 px-3 text-[12px]">
                  {c.credits === 0 ? t("pricing.costFree") : c.credits === 1 ? t("pricing.costCredit") : t("pricing.costCredits", { n: c.credits })}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      {/* questions */}
      <section aria-labelledby="faq-h" className="flex flex-col gap-5">
        <SectionHeading id="faq-h" title={t("pricing.faqTitle")} sub={t("pricing.faqSub")} center />
        <div className="grid items-start gap-3 lg:grid-cols-2">
          {faq.map(({ q: qq, a }) => (
            <details key={qq} className="group rounded-2xl border border-border bg-surface px-5 shadow-[var(--shadow)] open:border-accent/50">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-4 text-[14.5px] font-bold [&::-webkit-details-marker]:hidden">
                {qq}
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 text-muted transition-transform group-open:rotate-180">
                  <Icon name="down" size={16} />
                </span>
              </summary>
              <p className="m-0 pb-4 text-[14px] leading-relaxed text-muted">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <p className="m-0 flex items-center justify-center gap-2 text-center text-[12.5px] text-muted">
        <Icon name="lock" size={15} />
        {t(p.paymentsOpen ? "pricing.secure" : "pricing.soon")}
      </p>
    </div>
  );
}
