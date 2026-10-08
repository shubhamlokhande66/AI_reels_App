"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { useCredits, useMe } from "@/hooks/useApi";
import { pay } from "@/lib/razorpay";
import type { Credits, Pricing } from "@/types/api";
import { btnPrimary, btnSecondary, ErrorBanner, Spinner } from "@/components/ui";

const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

const FAQ = [
  ["What is a credit?", "Credits measure what you make. A Reel from your own clips uses 1 credit; a narrated Story Reel uses a few credits plus 1 for each AI picture. Classical paintings and library pictures are free. Previews are free."],
  ["Are prices including GST?", "Yes. The price you see is the price you pay."],
  ["What happens to unused credits?", "Plan credits renew every month and do not carry over. Starter and top-up credits never expire."],
  ["Does my plan renew by itself?", "No. You pay for a month or a year at a time; nothing is charged again unless you choose to renew."],
  ["What if a Reel fails?", "Its credits come back to you automatically."],
  ["Do I own my Reels?", "Yes. Download them, post them anywhere, use them for your business."],
  ["Is my footage kept?", "Uploaded clips are deleted automatically after a short time for your privacy. Download your Reel before then."],
] as const;

type Plan = Pricing["plans"][number];

function PlanCard({ plan, yearly, signedIn, paymentsOpen, current, busy, onBuy }: {
  plan: Plan;
  yearly: boolean;
  signedIn: boolean;
  paymentsOpen: boolean;
  current: boolean;
  busy: boolean;
  onBuy: () => void;
}) {
  const free = plan.monthly === 0;
  const price = yearly ? plan.yearly : plan.monthly;
  const perMonth = yearly && !free ? Math.round(plan.yearly / 12) : null;
  return (
    <div className={`lux-card relative flex flex-col rounded-3xl p-6 ${plan.highlight ? "border-accent/70 shadow-[0_0_0_1px_rgba(212,176,122,0.35)] lg:-translate-y-2" : ""}`}>
      {(plan.highlight || current) && (
        <span className="lux-btn-gold absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wider">
          {current ? "Your plan" : "Most popular"}
        </span>
      )}
      <h2 className="font-display text-2xl">{plan.name}</h2>
      <p className="mt-1 min-h-[2.5rem] text-sm text-muted">{plan.tagline}</p>
      <div className="mt-4">
        <span className="font-display text-4xl">{free ? "₹0" : rupees(price)}</span>
        {!free && <span className="ml-1 text-sm text-muted">/{yearly ? "year" : "month"}</span>}
        <p className="mt-1 h-5 text-xs text-muted">{perMonth ? `${rupees(perMonth)} a month, billed yearly` : free ? "No card needed" : "GST included"}</p>
      </div>
      <p className="mt-4 rounded-xl bg-accent/10 px-3 py-2 text-sm">
        <span className="font-semibold text-accent">{plan.credits} credits</span> <span className="text-muted">{plan.creditsNote}</span>
      </p>
      <ul className="mt-5 flex-1 space-y-2 text-sm">
        {plan.features.map((f) => (
          <li key={f} className="flex gap-2">
            <span className="text-accent">✓</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <div className="mt-6">
        {free ? (
          <Link href={signedIn ? "/projects/new" : "/login"} className={`${btnSecondary} w-full`}>
            {signedIn ? "Create a Reel" : "Start free"}
          </Link>
        ) : !paymentsOpen ? (
          <button type="button" disabled className={`${plan.highlight ? btnPrimary : btnSecondary} w-full`} title="Online payment opens soon">
            Coming soon
          </button>
        ) : !signedIn ? (
          <Link href="/login" className={`${plan.highlight ? btnPrimary : btnSecondary} w-full`}>
            Sign in to choose {plan.name}
          </Link>
        ) : (
          <button type="button" disabled={busy} onClick={onBuy} className={`${plan.highlight ? btnPrimary : btnSecondary} w-full`}>
            {busy ? "Opening payment…" : current ? `Extend ${plan.name}` : `Choose ${plan.name}`}
          </button>
        )}
      </div>
    </div>
  );
}

function MyCredits({ c }: { c: Extract<Credits, { enabled: true }> }) {
  return (
    <section className="lux-card mx-auto mt-8 max-w-3xl rounded-3xl p-6" aria-label="Your credits">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="lux-eyebrow">Your credits</p>
          <p className="font-display text-5xl text-accent">{c.balance}</p>
        </div>
        <div className="text-right text-sm text-muted">
          <p>
            Plan: <span className="text-foreground">{c.planName}</span>
            {c.period ? ` · ${c.period}` : ""}
          </p>
          {c.plan !== "free" && c.planEnds && <p>Active until {day(c.planEnds)}</p>}
          {c.plan !== "free" && c.renews && <p>Next {c.monthly === 0 ? "" : "monthly "}credits on {day(c.renews)}</p>}
          <p>
            {c.monthly} plan credits · {c.extra} never-expiring
          </p>
        </div>
      </div>
      {c.history.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-muted hover:text-accent">History</summary>
          <ul className="mt-3 divide-y divide-border text-sm">
            {c.history.map((h, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate">{h.reason}</span>
                <span className="shrink-0 text-xs text-muted">{day(h.at)}</span>
                <span className={`w-14 shrink-0 text-right font-semibold ${h.delta < 0 ? "text-muted" : "text-success"}`}>{h.delta > 0 ? `+${h.delta}` : h.delta}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
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

  return (
    <div className="lux-enter">
      <header className="mx-auto max-w-2xl text-center">
        <p className="lux-eyebrow">Pricing</p>
        <h1 className="mt-2 font-display text-4xl sm:text-5xl">Simple plans. Pay for what you make.</h1>
        <p className="mt-3 text-muted">Start free. Upgrade when your Reels start working for you. Prices include GST.</p>
        <div role="radiogroup" aria-label="Billing period" className="mt-6 inline-flex rounded-full border border-border p-1 text-sm">
          {([false, true] as const).map((y) => (
            <button
              key={String(y)}
              type="button"
              role="radio"
              aria-checked={yearly === y}
              onClick={() => setYearly(y)}
              className={`rounded-full px-4 py-1.5 transition ${yearly === y ? "lux-btn-gold font-semibold" : "text-muted hover:text-foreground"}`}
            >
              {y ? `Yearly · ${12 - p.yearlyMonthsCharged} months free` : "Monthly"}
            </button>
          ))}
        </div>
      </header>

      {mine && <MyCredits c={mine} />}
      {notice && (
        <p
          role="status"
          className={`mx-auto mt-6 max-w-xl rounded-2xl border px-4 py-3 text-center text-sm ${notice.ok ? "border-success/40 bg-success/10 text-success" : "border-danger/40 bg-danger/10 text-danger"}`}
        >
          {notice.text}
        </p>
      )}
      {!p.paymentsOpen && (
        <p className="mx-auto mt-6 max-w-xl rounded-2xl border border-border bg-surface-2/50 px-4 py-3 text-center text-sm text-muted">
          Paid plans open soon. Everything is free to try today.
        </p>
      )}

      <section className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4" aria-label="Plans">
        {p.plans.map((plan) => {
          const item = `plan:${plan.id}:${period}`;
          return (
            <PlanCard
              key={plan.id}
              plan={plan}
              yearly={yearly}
              signedIn={signedIn}
              paymentsOpen={p.paymentsOpen}
              current={!!mine && mine.plan === plan.id && plan.id !== "free"}
              busy={buying !== null}
              onBuy={() => void buy(item, `${plan.name} (${yearly ? "1 year" : "1 month"})`)}
            />
          );
        })}
      </section>

      <section className="mt-14 grid gap-5 lg:grid-cols-2">
        <div className="lux-card rounded-3xl p-6">
          <h2 className="font-display text-2xl">What a credit buys</h2>
          <table className="mt-4 w-full text-sm">
            <tbody className="divide-y divide-border">
              {p.creditCosts.map((c) => (
                <tr key={c.id}>
                  <td className="py-2.5 pr-3">{c.action}</td>
                  <td className="py-2.5 text-right font-semibold text-accent">{c.credits === 0 ? "Free" : `${c.credits} credit${c.credits > 1 ? "s" : ""}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="lux-card rounded-3xl p-6">
          <h2 className="font-display text-2xl">Need more credits?</h2>
          <p className="mt-1 text-sm text-muted">Top up anytime. Top-up credits never expire.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {p.topUps.map((t) => (
              <div key={t.id} className="flex flex-col rounded-2xl border border-border p-4">
                <p className="font-semibold">{t.credits} credits</p>
                <p className="font-display text-2xl">{rupees(t.price)}</p>
                <p className="text-xs text-muted">{rupees(Math.round((t.price / t.credits) * 10) / 10)} per credit</p>
                {p.paymentsOpen && signedIn && (
                  <button type="button" className={`${btnSecondary} mt-3 w-full`} disabled={buying !== null} onClick={() => void buy(`topup:${t.id}`, `${t.credits} credits`)}>
                    {buying === `topup:${t.id}` ? "Opening payment…" : "Buy"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto mt-14 max-w-3xl" aria-label="Questions">
        <h2 className="text-center font-display text-3xl">Questions</h2>
        <div className="mt-6 divide-y divide-border rounded-3xl border border-border">
          {FAQ.map(([q2, a]) => (
            <details key={q2} className="group px-5 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium">
                {q2}
                <span className="text-accent transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-2 text-sm text-muted">{a}</p>
            </details>
          ))}
        </div>
        <p className="mt-4 text-center text-xs text-muted">Payments are processed securely by Razorpay. We never see your card or UPI details.</p>
      </section>

      <div className="mt-14 text-center">
        <Link href={signedIn ? "/projects/new" : "/login"} className={btnPrimary}>
          ✦ {signedIn ? "Create a Reel now" : "Start free"}
        </Link>
      </div>
    </div>
  );
}
