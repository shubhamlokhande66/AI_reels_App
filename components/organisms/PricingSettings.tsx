"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import type { Pricing } from "@/types/api";
import { cn } from "@/lib/cn";
import { Badge, Button, Card, Heading, Icon, Input, TextArea, Toggle } from "@/components/atoms";
import { ErrorBanner, Field } from "@/components/molecules";

const COST_LABELS: Record<string, string> = {
  clip_reel: "Reel from clips",
  version: "New version / re-render",
  story_render: "Story Reel: narrate & render",
  ai_picture: "AI picture (story scene)",
  paid_picture: "Premium HD AI picture",
  preview: "Quick previews",
};

type Form = {
  plans: { id: string; name: string; monthly: number; credits: number; freeChats: number; highlight: boolean; ai: boolean; ads: boolean; hidden: boolean; features: string[] }[];
  topUps: { id: string; credits: number; price: number }[];
  costs: Record<string, number>;
};

const toForm = (p: Pricing): Form => ({
  plans: p.plans.map(({ id, name, monthly, credits, freeChats, highlight, ai, ads, hidden, features }) => ({ id, name, monthly, credits, freeChats: freeChats ?? 0, highlight: !!highlight, ai: ai ?? id !== "free", ads: ads ?? id === "free", hidden: !!hidden, features })),
  topUps: p.topUps.map((t) => ({ ...t })),
  costs: { ...p.costs },
});

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
      if (!whole(p.freeChats, 0) || p.freeChats > 50) return setFormError(`${p.name}: free chat changes must be 0 to 50.`);
    }
    for (const t of form.topUps) if (!whole(t.credits, 1) || !whole(t.price, 1)) return setFormError("Top-ups need whole numbers of credits and rupees.");
    for (const [k, v] of Object.entries(form.costs)) if (!whole(v, 0) || v > 100) return setFormError(`${COST_LABELS[k] ?? q.data?.costLabels?.[k] ?? k}: use 0 to 100 credits.`);
    save.mutate(form);
  }

  const labels = { ...COST_LABELS, ...(q.data.costLabels ?? {}) };
  const setFlag = (i: number, k: "ai" | "ads" | "hidden", v: boolean) => setForm((f) => f && { ...f, plans: f.plans.map((p, j) => (j === i ? { ...p, [k]: v } : p)) });
  const setName = (i: number, v: string) => setForm((f) => f && { ...f, plans: f.plans.map((p, j) => (j === i ? { ...p, name: v } : p)) });
  const setFeatures = (i: number, v: string) => setForm((f) => f && { ...f, plans: f.plans.map((p, j) => (j === i ? { ...p, features: v.split("\n") } : p)) });
  const setPlan = (i: number, k: "monthly" | "credits" | "freeChats", v: number) => setForm((f) => f && { ...f, plans: f.plans.map((p, j) => (j === i ? { ...p, [k]: v } : p)) });
  const setTop = (i: number, k: "credits" | "price", v: number) => setForm((f) => f && { ...f, topUps: f.topUps.map((t, j) => (j === i ? { ...t, [k]: v } : t)) });

  const setPopular = (i: number) => setForm((f) => f && { ...f, plans: f.plans.map((p, j) => ({ ...p, highlight: j === i })) });
  const num = (v: number) => (Number.isFinite(v) ? v : "");

  return (
    <div className="flex flex-col gap-4">
      {/* what this is, and what the server still needs */}
      <Card className="flex flex-col gap-2">
        <p className="m-0 text-[13px] leading-relaxed text-muted">
          Prices in rupees, GST included; yearly is 10 × the monthly price. With Shubix AI off, a plan&apos;s Reels are edited on the phone (no AI, no credits).
          Changes show on the pricing page at once; people who already paid keep what they bought.
        </p>
        {!q.data.billingEnabled && <p className="m-0 text-[12.5px] font-semibold text-warning">Billing is off on this server (BILLING_ENABLED): credits are not counted yet.</p>}
        {q.data.billingEnabled && !q.data.paymentsOpen && <p className="m-0 text-[12.5px] font-semibold text-warning">Payments are closed: add the Razorpay keys (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET) to open them.</p>}
      </Card>

      {/* one card per plan */}
      <section aria-label="Plans" className="grid gap-4 xl:grid-cols-2">
        {form.plans.map((p, i) => (
          <Card key={p.id} as="article" aria-label={p.name} className={cn("flex flex-col gap-4", p.highlight && "border-accent shadow-[0_18px_40px_-28px_var(--brand-glow)]", p.hidden && "opacity-70")}>
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent"><Icon name={p.id === "free" ? "sparkle" : p.id === "pro" ? "crown" : "bolt"} size={20} /></span>
              <div className="min-w-0 flex-1">
                <Heading size="section" as="h3">{p.name || p.id}</Heading>
                <span className="text-[12px] text-muted">{p.id === "free" ? "Free" : `₹${num(p.monthly)} a month`} · {num(p.credits)} credits</span>
              </div>
              {p.highlight && <Badge tone="brand">Most popular</Badge>}
              {p.hidden && <Badge>Not offered</Badge>}
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Name" className="col-span-2 sm:col-span-1"><Input aria-label="Plan name" value={p.name} maxLength={30} onChange={(e) => setName(i, e.target.value)} /></Field>
              <Field label="₹ a month">
                {p.id === "free" ? <Input value="Free" disabled /> : <Input type="number" min={1} inputMode="numeric" aria-label={`${p.name} price`} value={num(p.monthly)} onChange={(e) => setPlan(i, "monthly", e.target.valueAsNumber)} />}
              </Field>
              <Field label="Credits a month"><Input type="number" min={0} inputMode="numeric" aria-label={`${p.name} credits`} value={num(p.credits)} onChange={(e) => setPlan(i, "credits", e.target.valueAsNumber)} /></Field>
              <Field label="Free chats / Reel"><Input type="number" min={0} max={50} inputMode="numeric" aria-label={`${p.name} free chat changes per Reel`} value={num(p.freeChats)} onChange={(e) => setPlan(i, "freeChats", e.target.valueAsNumber)} /></Field>
            </div>

            <div className="grid gap-2.5 rounded-xl border border-border bg-surface-2/50 p-3 sm:grid-cols-2">
              <Toggle label="Shubix AI" hint="Off: Reels are edited on the phone" on={p.ai} onChange={(v) => setFlag(i, "ai", v)} />
              <Toggle label="Ads" hint="Shown on Home and My Reels" on={p.ads} onChange={(v) => setFlag(i, "ads", v)} />
              <Toggle label="Offered" hint={p.id === "free" ? "Free is always offered" : "On the pricing page"} on={!p.hidden} disabled={p.id === "free"} onChange={(v) => setFlag(i, "hidden", !v)} />
              <Toggle label="Most popular" hint="The badge (one plan)" on={p.highlight} onChange={(v) => v && setPopular(i)} />
            </div>

            <Field label="What it includes (one line each, on the pricing page)">
              <TextArea rows={5} value={p.features.join("\n")} onChange={(e) => setFeatures(i, e.target.value)} />
            </Field>
          </Card>
        ))}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* top-ups */}
        <Card as="section" aria-label="Top-ups" className="flex flex-col gap-3">
          <Heading size="section" as="h3">Top-ups</Heading>
          {form.topUps.map((t, i) => (
            <div key={t.id} className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-surface-2/50 p-3">
              <Field label="Credits"><Input type="number" min={1} inputMode="numeric" aria-label="Top-up credits" value={num(t.credits)} onChange={(e) => setTop(i, "credits", e.target.valueAsNumber)} /></Field>
              <Field label="Price (₹)"><Input type="number" min={1} inputMode="numeric" aria-label="Top-up price" value={num(t.price)} onChange={(e) => setTop(i, "price", e.target.valueAsNumber)} /></Field>
            </div>
          ))}
        </Card>

        {/* credits per action */}
        <Card as="section" aria-label="Credits per action" className="flex flex-col gap-3">
          <Heading size="section" as="h3">Credits per action</Heading>
          <div className="flex flex-col divide-y divide-border">
            {Object.entries(form.costs).map(([k, v]) => (
              <label key={k} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                <span className="min-w-0">{labels[k] ?? k}</span>
                <Input type="number" min={0} max={100} inputMode="numeric" className="w-20 shrink-0 text-right" value={num(v)} onChange={(e) => setForm((f) => f && { ...f, costs: { ...f.costs, [k]: e.target.valueAsNumber } })} />
              </label>
            ))}
          </div>
        </Card>
      </div>

      {/* save */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {(formError || save.error) && <div className="mr-auto min-w-0 flex-1"><ErrorBanner message={formError ?? errorMessage(save.error)} /></div>}
        {saved && !save.isPending && <span className="mr-auto text-[13px] font-semibold text-success">✓ Saved. The pricing page shows the new prices.</span>}
        <Button icon="check" loading={save.isPending} onClick={submit}>{save.isPending ? "Saving…" : "Save prices"}</Button>
      </div>
    </div>
  );
}
