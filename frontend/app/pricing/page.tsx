"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { useMe } from "@/hooks/useApi";
import type { Pricing } from "@/types/api";
import { btnPrimary, btnSecondary, ErrorBanner, Spinner } from "@/components/ui";

const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;

const FAQ = [
  ["What is a credit?", "Credits measure what you make. A Reel from your own clips uses 1 credit; a narrated Story Reel with its pictures uses about 10. You only use credits when a Reel is made."],
  ["Are prices including GST?", "Yes. The price you see is the price you pay."],
  ["What happens to unused credits?", "Monthly credits renew each month and do not carry over. Top-up credits stay until you use them."],
  ["Can I cancel?", "Yes, anytime. Your plan stays active until the end of the period you paid for."],
  ["Do I own my Reels?", "Yes. Download them, post them anywhere, use them for your business."],
  ["Is my footage kept?", "Uploaded clips are deleted automatically after a short time for your privacy. Download your Reel before then."],
] as const;

function PlanCard({ plan, yearly, signedIn, paymentsOpen }: { plan: Pricing["plans"][number]; yearly: boolean; signedIn: boolean; paymentsOpen: boolean }) {
  const free = plan.monthly === 0;
  const price = yearly ? plan.yearly : plan.monthly;
  const perMonth = yearly && !free ? Math.round(plan.yearly / 12) : null;
  return (
    <div
      className={`lux-card relative flex flex-col rounded-3xl p-6 ${plan.highlight ? "border-accent/70 shadow-[0_0_0_1px_rgba(212,176,122,0.35)] lg:-translate-y-2" : ""}`}
    >
      {plan.highlight && (
        <span className="lux-btn-gold absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wider">
          Most popular
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
        ) : paymentsOpen ? (
          <button type="button" className={`${plan.highlight ? btnPrimary : btnSecondary} w-full`}>
            Choose {plan.name}
          </button>
        ) : (
          <button type="button" disabled className={`${plan.highlight ? btnPrimary : btnSecondary} w-full`} title="Online payment opens soon">
            Coming soon
          </button>
        )}
      </div>
    </div>
  );
}

/** Plans and credits. Open to everyone (also before signing in). */
export default function PricingPage() {
  const q = useQuery({ queryKey: ["plans"], queryFn: api.plans, staleTime: 300_000 });
  const me = useMe();
  const [yearly, setYearly] = useState(false);
  const signedIn = !!me.data?.user || me.data?.authEnabled === false;

  if (q.isLoading) return <Spinner label="Loading plans…" />;
  if (q.error || !q.data) return <ErrorBanner message={errorMessage(q.error ?? new Error("Plans are not available."))} onRetry={() => void q.refetch()} />;
  const p = q.data;

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

      {!p.paymentsOpen && (
        <p className="mx-auto mt-6 max-w-xl rounded-2xl border border-border bg-surface-2/50 px-4 py-3 text-center text-sm text-muted">
          Paid plans open soon. Everything is free to try today.
        </p>
      )}

      <section className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4" aria-label="Plans">
        {p.plans.map((plan) => (
          <PlanCard key={plan.id} plan={plan} yearly={yearly} signedIn={signedIn} paymentsOpen={p.paymentsOpen} />
        ))}
      </section>

      <section className="mt-14 grid gap-5 lg:grid-cols-2">
        <div className="lux-card rounded-3xl p-6">
          <h2 className="font-display text-2xl">What a credit buys</h2>
          <table className="mt-4 w-full text-sm">
            <tbody className="divide-y divide-border">
              {p.creditCosts.map((c) => (
                <tr key={c.action}>
                  <td className="py-2.5 pr-3">{c.action}</td>
                  <td className="py-2.5 text-right font-semibold text-accent">
                    {c.credits === 0 ? "Free" : typeof c.credits === "number" ? `${c.credits} credit${c.credits > 1 ? "s" : ""}` : c.credits}
                  </td>
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
              <div key={t.id} className="rounded-2xl border border-border p-4">
                <p className="font-semibold">{t.credits} credits</p>
                <p className="font-display text-2xl">{rupees(t.price)}</p>
                <p className="text-xs text-muted">{rupees(Math.round((t.price / t.credits) * 10) / 10)} per credit</p>
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
      </section>

      <div className="mt-14 text-center">
        <Link href={signedIn ? "/projects/new" : "/login"} className={btnPrimary}>
          ✦ {signedIn ? "Create a Reel now" : "Start free"}
        </Link>
      </div>
    </div>
  );
}
