"use client";

import { useState } from "react";
import { useSafeQuery as useQuery } from "@/lib/useSafeQuery";
import { api, errorMessage } from "@/lib/api";
import { useT } from "@/hooks/useApi";
import { Badge, Button, Card, Heading, Icon, Input, Spinner } from "@/components/atoms";
import { EmptyState, ErrorBanner, Field, PageHeader, Segmented } from "@/components/molecules";
import { confirmAction } from "@/components/molecules/ConfirmDialog";
import type { AffiliateDetail, PayoutInput } from "@/lib/marketing";
import { AffiliateView, dayOf } from "@/components/organisms/AffiliateView";

/** The affiliate's dashboard: their link and terms (set by the administrator for them), link clicks, the customers they
 * brought (usernames only), every sale with its commission, and the payouts. Every word: Admin → CMS → Affiliate dashboard. */
export default function AffiliatePage() {
  const t = useT();
  const q = useQuery({ queryKey: ["my-affiliate"], queryFn: api.myAffiliate, retry: false });
  if (q.isLoading) return <Spinner label={t("aff.loading")} />;
  if (q.error) return <ErrorBanner message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  const a = q.data?.affiliate;
  if (!a) return <div className="mx-auto mt-6 max-w-md"><EmptyState icon="coins" title={t("aff.notYet")} action={<Button href="/rewards">{t("aff.toRewards")}</Button>} /></div>;
  if (a.status !== "active")
    return (
      <div className="mx-auto mt-6 max-w-md">
        <EmptyState icon="coins" title={t(a.status === "pending" ? "aff.pendingTitle" : "aff.pausedTitle")} hint={t(a.status === "pending" ? "rewards.affPending" : "rewards.affPaused")}
          action={<Button href="/rewards" variant="secondary">{t("aff.toRewards")}</Button>} />
      </div>
    );
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeader title={t("nav.affiliate")} subtitle={t("aff.sub")} />
      <div className="-mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
        <Badge tone="success">@{a.username}</Badge>
        {a.since && <span>· {dayOf(a.since)}</span>}
      </div>
      <PayoutCard a={a} onSaved={() => void q.refetch()} />
      <AffiliateView a={a} />
    </div>
  );
}

const where = (p: NonNullable<AffiliateDetail["payout"]>) => (p.method === "upi" ? p.upi : `${p.name} · ${p.account} · ${p.ifsc}`);

/** Where the affiliate is paid: a UPI ID or a bank account (asked first; the account number shows its last 4 only). */
function PayoutCard({ a, onSaved }: { a: AffiliateDetail; onSaved: () => void }) {
  const t = useT(), p = a.payout;
  const [edit, setEdit] = useState(!p), [method, setMethod] = useState<"upi" | "bank">(p?.method ?? "upi");
  const [upi, setUpi] = useState(p?.method === "upi" ? p.upi : ""), [name, setName] = useState(p?.method === "bank" ? p.name : "");
  const [account, setAccount] = useState(""), [ifsc, setIfsc] = useState(p?.method === "bank" ? p.ifsc : "");
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null), [done, setDone] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setDone(false);
    const d: PayoutInput = method === "upi" ? { method, upi: upi.trim() } : { method, name: name.trim(), account: account.replace(/\s/g, ""), ifsc: ifsc.trim().toUpperCase() };
    const shown = d.method === "upi" ? d.upi : `${d.name} · ${d.account} · ${d.ifsc}`;
    if (!(await confirmAction({ title: t("aff.payConfirm", { where: shown }), ok: t("aff.paySave") }))) return;
    setBusy(true);
    try { await api.setPayout(d); setDone(true); setEdit(false); setAccount(""); onSaved(); } catch (x) { setErr(errorMessage(x)); } finally { setBusy(false); }
  };
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Heading size="section" as="h2">{t("aff.payTitle")}</Heading>
          <p className="m-0 mt-0.5 text-[12.5px] text-muted">{p ? t("aff.paySub") : t("aff.payMissing")}</p>
        </div>
        {p && !edit && <Button size="sm" variant="secondary" icon="pen" onClick={() => setEdit(true)}>{t("aff.payEdit")}</Button>}
      </div>
      {p && !edit && <p className="m-0 flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-[13px]"><Icon name="check" size={14} className="text-success" />{t("aff.payNow", { where: where(p) })}</p>}
      {done && !edit && <p className="m-0 text-[12.5px] font-semibold text-success">{t("aff.paySaved")}</p>}
      {edit && (
        <form onSubmit={save} className="flex flex-col gap-3">
          <Segmented label={t("aff.payTitle")} value={method} onChange={(v) => setMethod(v as "upi" | "bank")} className="self-start"
            options={[{ value: "upi", label: t("aff.payUpi") }, { value: "bank", label: t("aff.payBank") }]} />
          {method === "upi" ? (
            <Field label={t("aff.upiLabel")} hint={t("aff.upiHint")}><Input value={upi} onChange={(e) => setUpi(e.target.value)} autoComplete="off" inputMode="email" placeholder="name@bank" required /></Field>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t("aff.bankName")}><Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required /></Field>
              <Field label={t("aff.bankAccount")}><Input value={account} onChange={(e) => setAccount(e.target.value)} inputMode="numeric" autoComplete="off" required
                placeholder={p?.method === "bank" ? t("aff.bankAccountKeep", { last4: p.account.slice(-4) }) : ""} /></Field>
              <Field label={t("aff.bankIfsc")}><Input value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase())} autoComplete="off" placeholder="SBIN0001234" required /></Field>
            </div>
          )}
          {err && <ErrorBanner message={err} />}
          <div className="flex justify-end gap-2">
            {p && <Button type="button" variant="ghost" size="sm" onClick={() => { setEdit(false); setErr(null); }}>{t("common.cancel")}</Button>}
            <Button type="submit" size="sm" icon="check" loading={busy}>{t("aff.paySave")}</Button>
          </div>
        </form>
      )}
    </Card>
  );
}
