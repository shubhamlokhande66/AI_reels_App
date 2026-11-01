"use client";

import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { useText } from "@/hooks/useApi";
import { Button, Icon, Input, Spinner } from "@/components/atoms";
import { ErrorBanner, SidePanel } from "@/components/molecules";
import { rupees } from "@/components/organisms/pricing/PlanCard";
import type { Quote } from "@/lib/marketing";

/** Before the payment window: what you pay (the price, a sale running, your coupon) and the total, worked out by the
 * server (Admin → Marketing sets the offers and codes). Pay opens Razorpay with that total. */
export function Checkout({ item, label, onClose, onPay, busy }: { item: string | null; label: string; onClose: () => void; onPay: (coupon?: string) => void; busy: boolean }) {
  const text = useText();
  const [q, setQ] = useState<Quote | null>(null), [err, setErr] = useState<string | null>(null), [loading, setLoading] = useState(false);
  const [code, setCode] = useState(""), [applied, setApplied] = useState<string | undefined>(undefined), [codeErr, setCodeErr] = useState("");

  const check = async (coupon?: string) => {
    if (!item) return;
    setLoading(true); setErr(null);
    try {
      const r = await api.quote(item, coupon);
      setQ(r);
      if (coupon && r.couponError) { setCodeErr(r.couponError); setApplied(undefined); } else { setCodeErr(""); setApplied(coupon); }
    } catch (e) { setErr(errorMessage(e)); } finally { setLoading(false); }
  };
  useEffect(() => { void Promise.resolve().then(() => { setQ(null); setCode(""); setApplied(undefined); setCodeErr(""); if (item) void check(); }); }, [item]); // eslint-disable-line react-hooks/exhaustive-deps -- a new item: priced afresh

  const row = (name: React.ReactNode, value: React.ReactNode, tone = "") => (
    <div className={`flex items-center justify-between gap-3 text-[13.5px] ${tone}`}><span>{name}</span><span className="tabular-nums">{value}</span></div>
  );
  return (
    <SidePanel open={!!item} onClose={onClose} title={text("pricing.checkoutTitle")} where={label}
      footer={q && <Button size="lg" full icon="bolt" loading={busy} disabled={loading} onClick={() => onPay(applied)}>{text("pricing.payNow", { price: rupees(q.final) })}</Button>}>
      {err && <ErrorBanner message={err} onRetry={() => void check(applied)} />}
      {!q && !err && <Spinner label={text("pricing.checking")} />}
      {q && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-surface p-4">
            {row(text("pricing.checkoutPrice"), rupees(q.base))}
            {q.offer && row(<span className="inline-flex items-center gap-1.5"><Icon name="sparkle" size={14} className="text-accent" />{text("pricing.checkoutOffer", { title: q.offer.title })} · {q.offer.percent}%</span>, `−${rupees(q.offer.off)}`, "text-success")}
            {q.coupon && row(<span className="inline-flex items-center gap-1.5"><Icon name="tag" size={14} className="text-accent" />{text("pricing.checkoutCoupon", { code: q.coupon.code })} · {q.coupon.label}</span>, `−${rupees(q.coupon.off)}`, "text-success")}
            <div className="my-0.5 h-px bg-border" />
            {row(<b className="text-[15px]">{text("pricing.checkoutTotal")}</b>, <b className="font-[family-name:var(--font-display)] text-[22px]">{rupees(q.final)}</b>)}
          </div>
          <form className="flex flex-col gap-1.5" onSubmit={(e) => { e.preventDefault(); if (code.trim()) void check(code.trim().toUpperCase()); }}>
            <label htmlFor="coupon" className="text-[12px] font-semibold text-muted">{text("pricing.couponLabel")}</label>
            <div className="flex gap-2">
              <Input id="coupon" value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setCodeErr(""); }} placeholder={text("pricing.couponPlaceholder")} autoCapitalize="characters" autoComplete="off"
                className={codeErr ? "border-danger font-mono" : "font-mono"} aria-invalid={!!codeErr || undefined} disabled={!!applied} />
              {applied
                ? <Button type="button" variant="secondary" onClick={() => { setCode(""); void check(); }}>{text("pricing.couponRemove")}</Button>
                : <Button type="submit" variant="secondary" loading={loading && !!code} disabled={!code.trim()}>{text("pricing.couponApply")}</Button>}
            </div>
            {codeErr && <p role="alert" className="m-0 text-[12px] text-danger">{codeErr}</p>}
            {applied && q.coupon && <p role="status" className="m-0 text-[12px] text-success">{text("pricing.couponApplied", { label: q.coupon.label })}</p>}
          </form>
          <p className="m-0 flex items-start gap-2 text-[12px] text-muted"><Icon name="shield" size={14} className="mt-0.5 shrink-0" />{text("pricing.secure")}</p>
        </div>
      )}
    </SidePanel>
  );
}
