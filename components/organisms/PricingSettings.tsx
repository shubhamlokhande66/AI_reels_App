"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import type { Pricing } from "@/types/api";
import { btnPrimary, Card } from "@/components/atoms";
import { ErrorBanner } from "@/components/molecules";

const COST_LABELS: Record<string, string> = {
  clip_reel: "Reel from clips",
  version: "New version / re-render",
  story_render: "Story Reel: narrate & render",
  ai_picture: "AI picture (story scene)",
  paid_picture: "Premium HD AI picture",
  preview: "Quick previews",
};

type Form = {
  plans: { id: string; name: string; monthly: number; credits: number; ai: boolean; ads: boolean; hidden: boolean; features: string[] }[];
  topUps: { id: string; credits: number; price: number }[];
  costs: Record<string, number>;
};

const toForm = (p: Pricing): Form => ({
  plans: p.plans.map(({ id, name, monthly, credits, ai, ads, hidden, features }) => ({ id, name, monthly, credits, ai: ai ?? id !== "free", ads: ads ?? id === "free", hidden: !!hidden, features })),
  topUps: p.topUps.map((t) => ({ ...t })),
  costs: { ...p.costs },
});

const NUM = "w-24 rounded-xl border border-border bg-surface px-2.5 py-1.5 text-right outline-none focus:border-accent";

/** Admin: plan prices, credits per plan, top-ups and how many credits each action uses. */
export function PricingSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["plans"], queryFn: api.plans });
  const [form, setForm] = useState<Form | null>(null);
  const [loadedFrom, setLoadedFrom] = useState<Pricing | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  if (q.data && q.data !== loadedFrom) {
    setLoadedFrom(q.data);
    setForm(toForm(q.data));
  }

  const save = useMutation({
    mutationFn: (f: Form) => api.setPricing({ plans: f.plans.map((p) => ({ ...p, features: p.features.map((x) => x.trim()).filter(Boolean) })), topUps: f.topUps, costs: f.costs }),
    onSuccess: (p) => {
      qc.setQueryData(["plans"], p);
      setSaved(true);
    },
  });

  if (!form || !q.data) return null;
  const whole = (n: number, lo: number) => Number.isInteger(n) && n >= lo;

  function submit() {
    if (!form) return;
    setFormError(null);
    setSaved(false);
    for (const p of form.plans) {
      if (p.id !== "free" && !whole(p.monthly, 1)) return setFormError(`${p.name}: the price must be a whole number of rupees (at least 1).`);
      if (!whole(p.credits, 0)) return setFormError(`${p.name}: credits must be a whole number.`);
    }
    for (const t of form.topUps) if (!whole(t.credits, 1) || !whole(t.price, 1)) return setFormError("Top-ups need whole numbers of credits and rupees.");
    for (const [k, v] of Object.entries(form.costs)) if (!whole(v, 0) || v > 100) return setFormError(`${COST_LABELS[k] ?? q.data?.costLabels?.[k] ?? k}: use 0 to 100 credits.`);
    save.mutate(form);
  }

  const labels = { ...COST_LABELS, ...(q.data.costLabels ?? {}) };
  const setFlag = (i: number, k: "ai" | "ads" | "hidden", v: boolean) => setForm((f) => f && { ...f, plans: f.plans.map((p, j) => (j === i ? { ...p, [k]: v } : p)) });
  const setName = (i: number, v: string) => setForm((f) => f && { ...f, plans: f.plans.map((p, j) => (j === i ? { ...p, name: v } : p)) });
  const setFeatures = (i: number, v: string) => setForm((f) => f && { ...f, plans: f.plans.map((p, j) => (j === i ? { ...p, features: v.split("\n") } : p)) });
  const setPlan = (i: number, k: "monthly" | "credits", v: number) => setForm((f) => f && { ...f, plans: f.plans.map((p, j) => (j === i ? { ...p, [k]: v } : p)) });
  const setTop = (i: number, k: "credits" | "price", v: number) => setForm((f) => f && { ...f, topUps: f.topUps.map((t, j) => (j === i ? { ...t, [k]: v } : t)) });

  return (
    <Card className="max-w-2xl space-y-6">
      <div>
        <h2 className="font-medium">Plans & credits</h2>
        <p className="mt-1 text-sm text-muted">
          Prices in rupees, GST included. Yearly = 10 × the monthly price. Shubix AI off: that plan&apos;s Reels are edited on the phone (no AI, no
          credits). An AI Reel uses &quot;Shubix AI edits a Reel&quot; credits once; each Ask Shubix change uses the small or whole-Reel credits. Changes show on the pricing page at once; people who already paid keep
          what they bought.
        </p>
        {!q.data.billingEnabled && (
          <p className="mt-2 text-xs text-warning">Billing is off on this server (BILLING_ENABLED): credits are not counted yet.</p>
        )}
        {q.data.billingEnabled && !q.data.paymentsOpen && (
          <p className="mt-2 text-xs text-warning">Payments are closed: add the Razorpay keys (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET) to open them.</p>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="pb-2 font-normal">Plan</th>
              <th className="pb-2 text-right font-normal">₹ / month</th>
              <th className="pb-2 text-right font-normal">Credits</th>
              <th className="pb-2 text-center font-normal" title="Shubix AI in this plan (off: Reels are edited on the phone)">Shubix AI</th>
              <th className="pb-2 text-center font-normal" title="Ads shown to this plan">Ads</th>
              <th className="pb-2 text-center font-normal" title="Shown on the pricing page">Offered</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {form.plans.map((p, i) => (
              <tr key={p.id}>
                <td className="py-2"><input aria-label="Plan name" className="w-28 rounded-xl border border-border bg-surface px-2.5 py-1.5 outline-none focus:border-accent" value={p.name} maxLength={30} onChange={(e) => setName(i, e.target.value)} /></td>
                <td className="py-2 text-right">
                  {p.id === "free" ? (
                    <span className="text-muted">free</span>
                  ) : (
                    <input type="number" min={1} inputMode="numeric" aria-label={`${p.name} price`} className={NUM} value={p.monthly} onChange={(e) => setPlan(i, "monthly", e.target.valueAsNumber)} />
                  )}
                </td>
                <td className="py-2 text-right">
                  <input type="number" min={0} inputMode="numeric" aria-label={`${p.name} credits`} className={NUM} value={p.credits} onChange={(e) => setPlan(i, "credits", e.target.valueAsNumber)} />
                </td>
                <td className="py-2 text-center"><input type="checkbox" aria-label={`${p.name}: Shubix AI`} checked={p.ai} onChange={(e) => setFlag(i, "ai", e.target.checked)} /></td>
                <td className="py-2 text-center"><input type="checkbox" aria-label={`${p.name}: ads`} checked={p.ads} onChange={(e) => setFlag(i, "ads", e.target.checked)} /></td>
                <td className="py-2 text-center">{p.id === "free" ? <span className="text-muted">always</span> : <input type="checkbox" aria-label={`${p.name}: offered`} checked={!p.hidden} onChange={(e) => setFlag(i, "hidden", !e.target.checked)} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">What each plan says (one line each, on the pricing page)</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {form.plans.filter((p) => !p.hidden).map((p) => { const i = form.plans.indexOf(p); return (
            <label key={p.id} className="grid gap-1 text-sm"><span className="text-muted">{p.name}</span>
              <textarea rows={5} className="rounded-xl border border-border bg-surface px-2.5 py-1.5 outline-none focus:border-accent" value={p.features.join("\n")} onChange={(e) => setFeatures(i, e.target.value)} />
            </label>); })}
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">Top-ups</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {form.topUps.map((t, i) => (
            <div key={t.id} className="flex items-center gap-2 rounded-xl border border-border p-3 text-sm">
              <input type="number" min={1} aria-label="Top-up credits" className={NUM} value={t.credits} onChange={(e) => setTop(i, "credits", e.target.valueAsNumber)} />
              <span className="text-muted">credits for ₹</span>
              <input type="number" min={1} aria-label="Top-up price" className={NUM} value={t.price} onChange={(e) => setTop(i, "price", e.target.valueAsNumber)} />
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">Credits per action</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.entries(form.costs).map(([k, v]) => (
            <label key={k} className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2 text-sm">
              <span>{labels[k] ?? k}</span>
              <input
                type="number"
                min={0}
                max={100}
                className={NUM}
                value={v}
                onChange={(e) => setForm((f) => f && { ...f, costs: { ...f.costs, [k]: e.target.valueAsNumber } })}
              />
            </label>
          ))}
        </div>
      </div>

      {(formError || save.error) && <ErrorBanner message={formError ?? errorMessage(save.error)} />}
      {saved && !save.isPending && <p className="text-sm text-success">✓ Saved. The pricing page shows the new prices.</p>}
      <button type="button" className={btnPrimary} disabled={save.isPending} onClick={submit}>
        {save.isPending ? "Saving…" : "Save prices"}
      </button>
    </Card>
  );
}
