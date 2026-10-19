"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { useCredits, useMe } from "@/hooks/useApi";
import { pay } from "@/lib/razorpay";
import { cn } from "@/lib/cn";
import type { Credits } from "@/types/api";
import { Badge, Button, Card, Icon, Spinner } from "@/components/atoms";
import { ErrorBanner } from "@/components/molecules";
import { PlanAction, PlanCard, rupees } from "@/components/organisms/pricing/PlanCard";

const day = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

const FAQ = [
  ["What does a credit buy?", "Credits measure what you make. A Reel from your own clips uses 1 credit; a narrated Story Reel uses a few credits plus 1 for each AI picture. Classical paintings and library pictures are free. Previews are free."],
  ["Are prices including GST?", "Yes. The price you see is the price you pay."],
  ["What happens to unused credits?", "Plan credits renew every month and do not carry over. Starter and top-up credits never expire."],
  ["Can I cancel any time?", "Yes. You pay for a month or a year at a time and nothing renews by itself, so there is nothing to cancel."],
  ["What if a Reel fails?", "Its credits come back to you automatically."],
  ["Do I own my Reels?", "Yes. Download them, post them anywhere, use them for your business."],
  ["Is my footage kept?", "Uploaded clips are deleted automatically after a short time for your privacy. Download your Reel before then."],
] as const;

/** A section's heading on this page: the title and one line under it. */
function Heading({ title, sub, center = false }: { title: string; sub?: string; center?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-1", center && "items-center text-center")}>
      <h2 className="m-0 font-[family-name:var(--font-display)] text-[22px] font-extrabold tracking-[-0.01em] md:text-[26px]">{title}</h2>
      {sub && <p className="m-0 max-w-xl text-[14px] text-muted">{sub}</p>}
    </div>
  );
}

function MyCredits({ c }: { c: Extract<Credits, { enabled: true }> }) {
  return (
    <Card as="section" aria-label="Your credits" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-[13px] font-semibold text-muted">Your credits</span>
          <span className="flex items-center gap-2 font-[family-name:var(--font-display)] text-[34px] font-extrabold leading-tight tabular-nums">
            <Icon name="bolt" size={26} stroke={2.2} color="#6d8bff" />
            {c.balance.toLocaleString("en-IN")}
          </span>
        </div>
        <Badge tone="brand" className="h-8 px-3 text-[12.5px]">
          <Icon name="crown" size={14} />
          {c.planName} plan
        </Badge>
      </div>
      <p className="m-0 text-[12.5px] text-muted">
        {c.plan !== "free" && c.planEnds ? `Active until ${day(c.planEnds)} · ` : ""}
        {c.plan !== "free" && c.renews ? `New credits on ${day(c.renews)} · ` : ""}
        {c.extra.toLocaleString("en-IN")} never expire
      </p>
      {c.history.length > 0 && (
        <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
          {c.history.slice(0, 5).map((h, i) => (
            <li key={i} className="flex items-center justify-between gap-3 py-2 text-[13px]">
              <span className="min-w-0 truncate text-muted">{h.reason}</span>
              <span className={cn("shrink-0 font-bold tabular-nums", h.delta > 0 && "text-success")}>
                {h.delta > 0 ? `+${h.delta.toLocaleString("en-IN")}` : `−${Math.abs(h.delta).toLocaleString("en-IN")}`}
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
  const [yearly, setYearly] = useState(false);
  const [buying, setBuying] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const signedIn = !!me.data?.user || me.data?.authEnabled === false;
  const mine = credits.data?.enabled ? credits.data : null;

  async function buy(item: string, label: string) {
    setNotice(null);
    setBuying(item);
    try {
      const r = await pay(item);
      if (r.status === "paid") {
        qc.setQueryData(["credits"], r.credits);
        setNotice({ ok: true, text: `Payment received: ${label} is active. Thank you!` });
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

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 pb-4 md:gap-16">
      {/* the hero: what it costs, in one line */}
      <header className="relative flex flex-col items-center gap-4 pt-4 text-center md:pt-8">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-10 -z-10 mx-auto h-64 max-w-3xl rounded-full bg-[radial-gradient(closest-side,rgba(176,92,255,.28),transparent)] blur-2xl" />
        <Badge tone="brand" className="h-8 px-3.5 text-[12.5px] uppercase tracking-wider">
          <Icon name="coins" size={15} />
          Pricing
        </Badge>
        <h1 className="m-0 max-w-3xl font-[family-name:var(--font-display)] text-[clamp(34px,6.5vw,60px)] font-extrabold leading-[1.04] tracking-[-0.035em]">
          Simple plans. <span className="bg-[linear-gradient(90deg,#c084fc,#e040fb_55%,#ff4fd8)] bg-clip-text text-transparent">Pay for what you make.</span>
        </h1>
        <p className="m-0 max-w-xl text-[15.5px] leading-relaxed text-muted md:text-[17px]">Start free with {p.plans.find((x) => x.monthly === 0)?.credits ?? 15} credits. No card needed, nothing renews by itself, and every price includes GST.</p>

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
              {y ? "Yearly" : "Monthly"}
              {y && freeMonths > 0 && (
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-extrabold", yearly ? "bg-white/20 text-white" : "bg-success/15 text-success")}>
                  {freeMonths} months free
                </span>
              )}
            </button>
          ))}
        </div>
      </header>

      {notice && (
        <p role="status" className={cn("m-0 -mt-6 flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-center text-[14px] font-semibold", notice.ok ? "border-success/40 bg-success/10 text-success" : "border-danger/40 bg-danger/10 text-danger")}>
          <Icon name={notice.ok ? "check" : "warn"} size={18} stroke={2.2} />
          {notice.text}
        </p>
      )}

      {/* the plans */}
      <section aria-label="Plans" className="grid items-start gap-5 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
        {p.plans.map((plan) => {
          const item = `plan:${plan.id}:${period}`;
          const current = !!mine && mine.plan === plan.id && plan.id !== "free";
          return (
            <PlanCard
              key={plan.id}
              plan={plan}
              yearly={yearly}
              action={
                <PlanAction
                  plan={plan}
                  signedIn={signedIn}
                  paymentsOpen={p.paymentsOpen}
                  current={current}
                  busy={buying === item}
                  onBuy={() => void buy(item, `${plan.name} (${yearly ? "1 year" : "1 month"})`)}
                />
              }
            />
          );
        })}
      </section>

      {/* your credits and top-ups */}
      <section aria-label="Credits" className={cn("grid gap-5", mine && "md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]")}>
        {mine && <MyCredits c={mine} />}
        <Card as="section" aria-label="Top up" className="flex flex-col gap-4">
          <Heading title="Need more credits?" sub="Top up any time. Top-up credits never expire." />
          <div className="grid gap-3 sm:grid-cols-2">
            {p.topUps.map((t) => {
              const item = `topup:${t.id}`;
              return (
                <div key={t.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface-2 p-4">
                  <div className="flex flex-col">
                    <span className="flex items-center gap-1.5 font-[family-name:var(--font-display)] text-[22px] font-extrabold tabular-nums">
                      <Icon name="bolt" size={18} stroke={2.2} color="#6d8bff" />+{t.credits.toLocaleString("en-IN")}
                    </span>
                    <span className="text-[12px] text-muted">{rupees(Math.round((t.price / t.credits) * 10) / 10)} a credit</span>
                  </div>
                  <Button size="sm" variant="secondary" loading={buying === item} disabled={!p.paymentsOpen || !signedIn || (buying !== null && buying !== item)} title={!p.paymentsOpen ? "Online payment opens soon" : !signedIn ? "Sign in to top up" : undefined} onClick={() => void buy(item, `${t.credits} credits`)}>
                    {rupees(t.price)}
                  </Button>
                </div>
              );
            })}
          </div>
        </Card>
      </section>

      {/* what a credit buys */}
      <section aria-labelledby="costs-h" className="flex flex-col gap-5">
        <div id="costs-h">
          <Heading title="What a credit buys" sub="Previews and the edits made on your phone are free. A Reel that fails gives its credits back." center />
        </div>
        <Card className="!p-2 md:!p-3">
          <ul className="m-0 grid list-none gap-x-6 p-0 md:grid-cols-2">
            {p.creditCosts.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 border-b border-border px-3 py-3.5 last:border-b-0 md:[&:nth-last-child(2):nth-child(odd)]:border-b-0">
                <span className="flex min-w-0 items-center gap-2.5 text-[14px] font-semibold">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/12 text-accent">
                    <Icon name={c.credits === 0 ? "sparkle" : "bolt"} size={15} stroke={2} />
                  </span>
                  <span className="min-w-0">{c.action}</span>
                </span>
                <Badge tone={c.credits === 0 ? "success" : "brand"} className="h-7 shrink-0 px-3 text-[12px]">
                  {c.credits === 0 ? "Free" : `${c.credits} credit${c.credits > 1 ? "s" : ""}`}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      {/* questions */}
      <section aria-labelledby="faq-h" className="flex flex-col gap-5">
        <div id="faq-h">
          <Heading title="Questions" sub="Everything about plans, credits and payments." center />
        </div>
        <div className="grid items-start gap-3 md:grid-cols-2">
          {FAQ.map(([qq, a]) => (
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
        {p.paymentsOpen ? "Payments are handled securely by Razorpay. We never see your card or UPI details." : "Online payment opens soon."}
      </p>
    </div>
  );
}
