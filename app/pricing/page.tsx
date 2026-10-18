"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { useCredits, useMe } from "@/hooks/useApi";
import { pay } from "@/lib/razorpay";
import type { Credits, Pricing } from "@/types/api";
import { Icon, Spinner } from "@/components/atoms";
import { ErrorBanner } from "@/components/molecules";

const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;
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
  const pop = !!plan.highlight;
  const priceEl = (
    <span className="mono whitespace-nowrap">
      <b style={{ fontSize: pop ? 26 : 22 }}>{free ? "₹0" : rupees(price)}</b>
      {!free && <span className="mu sm">/{yearly ? "year" : "month"}</span>}
    </span>
  );
  const cls = `btn ${pop ? "g" : "sm"} w-full`;
  return (
    <div className={`plan ${pop ? "pop" : ""}`}>
      <div className="between">
        <b className="ht">{plan.name}</b>
        {current ? <span className="badge b-ok">Your plan</span> : pop ? <span className="badge b-run">Most popular</span> : null}
      </div>
      {priceEl}
      <span className="mu sm">
        {plan.credits.toLocaleString("en-IN")} credits · {plan.tagline}
        {perMonth ? ` · ${rupees(perMonth)} a month` : ""}
      </span>
      {plan.features.length > 0 && (
        <details className="sm">
          <summary className="ac cursor-pointer font-bold">What&apos;s included</summary>
          <ul className="mu mt-1.5 flex flex-col gap-1">
            {plan.creditsNote && <li>{plan.creditsNote}</li>}
            {plan.features.map((f) => (
              <li key={f}>· {f}</li>
            ))}
          </ul>
        </details>
      )}
      {free ? (
        <Link href={signedIn ? "/projects/new" : "/login"} className="btn sm w-full">
          {signedIn ? "Make a Reel" : "Start free"}
        </Link>
      ) : !paymentsOpen ? (
        <button type="button" disabled className={cls} title={current ? "This is your plan" : "Online payment opens soon"}>
          {current ? "Your current plan" : `Choose ${plan.name}`}
        </button>
      ) : !signedIn ? (
        <Link href="/login" className={cls}>
          Sign in to choose {plan.name}
        </Link>
      ) : (
        <button type="button" disabled={busy} onClick={onBuy} className={cls}>
          {busy ? "Opening payment…" : current ? `Extend ${plan.name}` : `Choose ${plan.name}`}
        </button>
      )}
    </div>
  );
}

function MyCredits({ c }: { c: Extract<Credits, { enabled: true }> }) {
  return (
    <section className="card" aria-label="Your credits">
      <div className="between">
        <span className="h2">Your credits</span>
        <span className="mono ac">
          <b>{c.balance.toLocaleString("en-IN")}</b>
        </span>
      </div>
      <span className="mu xs">
        {c.planName} plan{c.plan !== "free" && c.planEnds ? ` · active until ${day(c.planEnds)}` : ""}
        {c.plan !== "free" && c.renews ? ` · new credits on ${day(c.renews)}` : ""} · {c.extra.toLocaleString("en-IN")} never expire
      </span>
      {c.history.slice(0, 5).map((h, i) => (
        <div key={i} className="between sm">
          <span className="mu min-w-0 truncate">{h.reason}</span>
          <span className="mono shrink-0" style={h.delta > 0 ? { color: "var(--success)" } : undefined}>
            {h.delta > 0 ? `+${h.delta.toLocaleString("en-IN")}` : `−${Math.abs(h.delta).toLocaleString("en-IN")}`}
          </span>
        </div>
      ))}
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
    <div className="mx-auto flex w-full max-w-xl flex-col gap-3 md:max-w-4xl">
      <div className="text-center">
        <h1 className="h1" style={{ fontSize: "clamp(30px, 6vw, 44px)" }}>
          Simple plans. Pay for what you make.
        </h1>
        <p className="sub">Start free. Prices include GST.</p>
      </div>
      <div role="radiogroup" aria-label="Billing period" className="tabs2 self-center" style={{ width: 260 }}>
        {([false, true] as const).map((y) => (
          <button key={String(y)} type="button" role="radio" aria-checked={yearly === y} className={yearly === y ? "on" : ""} onClick={() => setYearly(y)}>
            {y ? `Yearly · ${12 - p.yearlyMonthsCharged} months free` : "Monthly"}
          </button>
        ))}
      </div>
      {notice && (
        <p role="status" className="card sm text-center" style={{ color: notice.ok ? "var(--success)" : "var(--danger)" }}>
          {notice.text}
        </p>
      )}

      <section className="grid gap-3 md:grid-cols-2 lg:grid-cols-4" aria-label="Plans">
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

      <div className="grid gap-3 md:grid-cols-2">
        {mine && <MyCredits c={mine} />}
        <section className="card" aria-label="Top up">
          <span className="h2">Need more credits?</span>
          <div className="g3">
            {p.topUps.map((t) => (
              <button
                key={t.id}
                type="button"
                className="btn sm !h-auto flex-col !gap-0 py-2"
                disabled={!p.paymentsOpen || !signedIn || buying !== null}
                title={`${t.credits} credits for ${rupees(t.price)}`}
                onClick={() => void buy(`topup:${t.id}`, `${t.credits} credits`)}
              >
                <span>{buying === `topup:${t.id}` ? "Opening…" : `+${t.credits.toLocaleString("en-IN")}`}</span>
                <span className="mu xs font-semibold">{rupees(t.price)}</span>
              </button>
            ))}
          </div>
          <span className="mu xs">Top-up credits never expire.</span>
        </section>
      </div>

      <section className="card" style={{ gap: 0 }} aria-label="What a credit buys">
        <span className="h2" style={{ marginBottom: 4 }}>
          What a credit buys
        </span>
        {p.creditCosts.map((c) => (
          <div key={c.id} className="li">
            <b className="sm">{c.action}</b>
            <span className="ac sm font-bold">{c.credits === 0 ? "Free" : `${c.credits} credit${c.credits > 1 ? "s" : ""}`}</span>
          </div>
        ))}
      </section>

      <section className="card" style={{ gap: 0 }} aria-label="Questions">
        <span className="h2" style={{ marginBottom: 4 }}>
          Questions
        </span>
        {FAQ.map(([q2, a]) => (
          <details key={q2} className="group border-b border-border last:border-b-0">
            <summary className="li !border-b-0 cursor-pointer list-none">
              <b className="sm">{q2}</b>
              <span className="mu transition-transform group-open:rotate-180">
                <Icon name="down" size={18} />
              </span>
            </summary>
            <p className="mu sm pb-3">{a}</p>
          </details>
        ))}
      </section>
      <span className="mu xs text-center">
        {p.paymentsOpen ? "Payments are handled securely by Razorpay. We never see your card or UPI details." : "Online payment opens soon"}
      </span>
    </div>
  );
}
