"use client";

import { useState } from "react";
import { useT } from "@/hooks/useApi";
import { cn } from "@/lib/cn";
import { Badge, Button, Icon, Input } from "@/components/atoms";
import { StatTile } from "@/components/molecules";
import type { AffiliateDetail } from "@/lib/marketing";

/** One affiliate's picture, shared by their own dashboard (/affiliate) and Admin → Marketing → a partner: the link, the
 * terms, the numbers, the customers they brought, every sale with its commission, and the payouts. `admin`: emails too. */
export const rupee = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
export const dayOf = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");

export function AffiliateView({ a, admin = false }: { a: AffiliateDetail; admin?: boolean }) {
  const t = useT(), [copied, setCopied] = useState(false), [tab, setTab] = useState<"customers" | "sales" | "payouts">("sales");
  const link = a.link.startsWith("/") && typeof window !== "undefined" ? window.location.origin + a.link : a.link;
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* select by hand */ } };
  const tabs = [["sales", t("aff.sales"), a.sales.length], ["customers", t("aff.customers"), a.customers.length], ["payouts", t("aff.payouts"), a.payouts.length]] as const;
  return (
    <div className="flex flex-col gap-4">
      {/* the link */}
      <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{t("aff.link")}</span>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="min-w-0 font-mono text-[13px] sm:flex-1" />
          <div className="flex gap-2">
            <Button icon={copied ? "check" : "copy"} onClick={copy} className="flex-1 sm:flex-none">{copied ? t("rewards.copied") : t("rewards.copy")}</Button>
            {!admin && <Button variant="secondary" icon="share" href={`https://wa.me/?text=${encodeURIComponent(t("rewards.shareText", { link }))}`} className="flex-1 sm:flex-none">{t("rewards.whatsapp")}</Button>}
          </div>
        </div>
        {/* the terms */}
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Badge tone="brand">{t("aff.termPercent", { n: a.percent })}</Badge>
          <Badge tone="neutral">{t("aff.termMonths", { n: a.months })}</Badge>
          <Badge tone={a.validUntil ? "warning" : "neutral"}>{a.validUntil ? t("aff.termUntil", { date: dayOf(a.validUntil) }) : t("aff.termNoEnd")}</Badge>
          <Badge tone="neutral">{t("aff.termPayout", { n: a.minPayout })}</Badge>
        </div>
      </div>

      {/* the numbers */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatTile value={a.stats.clicks} label={t("aff.clicks")} note={t("aff.last30", { n: a.stats.clicks30 })} />
        <StatTile value={a.stats.customers} label={t("aff.customers")} note={t("aff.buyers", { n: a.stats.buyers })} />
        <StatTile value={rupee(a.stats.due)} label={t("rewards.affDue")} />
        <StatTile value={rupee(a.stats.paid)} label={t("rewards.affPaid")} note={t("aff.revenue", { n: rupee(a.stats.revenue) })} />
      </div>

      {/* the lists */}
      <div className="flex flex-col gap-2">
        <div role="tablist" className="inline-flex w-fit gap-1 rounded-xl border border-border bg-surface-2 p-1">
          {tabs.map(([id, name, n]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={cn("rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors", tab === id ? "bg-surface text-foreground shadow-[var(--shadow)]" : "text-muted hover:text-foreground")}>
              {name} <span className="text-muted">{n}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-1.5">
          {tab === "sales" && (a.sales.length ? a.sales.map((s) => (
            <Row key={s.id} left={<><b>{s.customer ? `@${s.customer}` : "—"}</b> <span className="text-muted">· {dayOf(s.at)} · {rupee(s.paid)} × {s.percent}%</span></>}
              right={<><b className="tabular-nums">+{rupee(s.commission)}</b><Badge tone={s.status === "paid" ? "success" : "warning"}>{s.status === "paid" ? t("aff.statusPaid") : t("aff.statusDue")}</Badge></>} />
          )) : <Empty text={t("aff.noSales")} />)}
          {tab === "customers" && (a.customers.length ? a.customers.map((c, i) => (
            <Row key={i} left={<><b>{c.username ? `@${c.username}` : "—"}</b>{admin && c.email ? <span className="text-muted"> · {c.email}</span> : null} <span className="text-muted">· {t("aff.joined", { date: dayOf(c.joined) })}</span></>}
              right={<>{c.paid ? <span className="tabular-nums text-muted">{rupee(c.paid)}</span> : null}<span className="text-[11.5px] text-muted">{c.countsUntil ? t("aff.countsUntil", { date: dayOf(c.countsUntil) }) : t("aff.afterEnd")}</span></>} />
          )) : <Empty text={t("aff.noCustomers")} />)}
          {tab === "payouts" && (a.payouts.length ? a.payouts.map((p) => (
            <Row key={p.id} left={<><b className="tabular-nums">{rupee(p.total)}</b> <span className="text-muted">· {dayOf(p.at)} · {t("aff.payoutSales", { n: p.count })}{p.note ? ` · ${t("aff.ref", { ref: p.note })}` : ""}</span></>}
              right={<Badge tone="success"><Icon name="check" size={11} />{t("aff.statusPaid")}</Badge>} />
          )) : <Empty text={t("aff.noPayouts")} />)}
        </div>
      </div>
    </div>
  );
}
const Row = ({ left, right }: { left: React.ReactNode; right: React.ReactNode }) => (
  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-[13px]">
    <span className="min-w-0 truncate">{left}</span>
    <span className="flex shrink-0 items-center gap-2">{right}</span>
  </div>
);
const Empty = ({ text }: { text: string }) => <p className="m-0 rounded-xl bg-surface-2 px-3 py-4 text-center text-[12.5px] text-muted">{text}</p>;
