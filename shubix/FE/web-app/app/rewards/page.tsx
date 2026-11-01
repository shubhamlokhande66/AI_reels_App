"use client";

import { toast } from "@/lib/toast";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSafeQuery as useQuery } from "@/lib/useSafeQuery";
import { api, errorMessage } from "@/lib/api";
import { useCredits, useText } from "@/hooks/useApi";
import { Badge, Button, Card, Heading, Icon, Input } from "@/components/atoms";
import { EmptyState, ErrorBanner, Field, PageHeader, StatTile } from "@/components/molecules";
import { confirmAction } from "@/components/molecules/ConfirmDialog";
import { Spinner } from "@/components/atoms";
import type { MyMarketing } from "@/lib/marketing";
import { AdSlot } from "@/components/organisms/AdSlot";

/** Invite & earn: invite friends (both get credits), send credits to a friend by @username, the affiliate program and
 * your username. Every rule (credits, limits, %) is the administrator's (Admin → Marketing); every word is in the CMS. */
export default function RewardsPage() {
  const text = useText();
  const q = useQuery({ queryKey: ["my-marketing"], queryFn: api.myMarketing, retry: false });
  const credits = useCredits();
  if (q.isLoading) return <Spinner label={text("rewards.loading")} />;
  if (credits.data && !credits.data.enabled) return <div className="mx-auto mt-6 max-w-md"><EmptyState icon="gift" title={text("nav.rewards")} hint={text("rewards.off")} /></div>;
  if (q.error || !q.data) return <ErrorBanner message={errorMessage(q.error ?? new Error("Not available."))} onRetry={() => void q.refetch()} />;
  const m = q.data;
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeader title={text("nav.rewards")} subtitle={text("rewards.sub")} />
      <Invite m={m} />
      <div className="grid gap-5 lg:grid-cols-2">
        <SendCredits m={m} />
        <Username m={m} />
      </div>
      {m.affiliate.on && <Affiliate m={m} />}{/* cash payouts: the website only (the phone app has no affiliate program) */}
      <AdSlot place="rewards" />
    </div>
  );
}

function Invite({ m }: { m: MyMarketing }) {
  const text = useText(), [copied, setCopied] = useState(false), r = m.referral;
  const link = m.link.startsWith("/") ? window.location.origin + m.link : m.link;
  const step = (s: string) => text(s === "signup" ? "rewards.whenSignup" : s === "purchase" ? "rewards.whenPurchase" : "rewards.whenVerified");
  const shareText = text("rewards.shareText", { link });
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); toast.success(text("rewards.copied")); setTimeout(() => setCopied(false), 1800); } catch { /* the field can be selected by hand */ } };
  return (
    <Card className="relative flex flex-col gap-4 overflow-hidden p-5 md:p-6">
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--accent)_22%,transparent),transparent)]" />
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gold text-on-accent shadow-[0_10px_24px_-12px_var(--accent)]"><Icon name="gift" size={22} /></span>
        <div className="min-w-0">
          <Heading size="title" as="h2">{text("rewards.inviteTitle")}</Heading>
          <p className="m-0 mt-1 text-[13px] text-muted">{r.on ? text("rewards.inviteLine2", { you: r.inviterCredits, friend: r.inviteeCredits, friendWhen: step(r.inviteeOn), youWhen: step(r.inviterOn) }) : text("rewards.inviteOff")}</p>
          {/* what the credits are for, said plainly: on Free they pay for Shubix AI (or wait for an upgrade) */}
          {r.on && !m.ai.planAi && (
            <p className="m-0 mt-2 inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-[12px] font-semibold text-accent">
              <Icon name="sparkle" size={13} />{m.ai.freeWithCredits ? text("rewards.creditsFreeAi", { n: m.ai.reelCost }) : text("rewards.creditsKept")}
            </p>
          )}
        </div>
      </div>
      {r.on && (
        <>
          <Field label={text("rewards.yourLink")}>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="min-w-0 font-mono text-[13px] sm:flex-1" />
              <div className="flex gap-2">
                <Button icon={copied ? "check" : "copy"} onClick={copy} className="flex-1 sm:flex-none">{copied ? text("rewards.copied") : text("rewards.copy")}</Button>
                <Button variant="secondary" icon="share" href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} className="flex-1 sm:flex-none">{text("rewards.whatsapp")}</Button>
              </div>
            </div>
          </Field>
          <div className="grid gap-2.5 sm:grid-cols-3">
            <StatTile value={r.invited} label={text("rewards.invited")} />
            <StatTile value={r.rewarded} label={text("rewards.rewarded")} />
            <StatTile value={r.earned} label={text("rewards.earned")} />
          </div>
        </>
      )}
    </Card>
  );
}

function SendCredits({ m }: { m: MyMarketing }) {
  const text = useText(), qc = useQueryClient(), s = m.share;
  const [to, setTo] = useState(""), [amount, setAmount] = useState(""), [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const left = Math.max(0, s.dailyMax - s.sentToday), n = Number(amount), name = to.trim().replace(/^@/, "");
  const valid = name.length >= 3 && Number.isInteger(n) && n >= s.min && n <= Math.min(s.max, left);
  async function send(e: React.FormEvent) {
    e.preventDefault(); if (!valid) return;
    if (!(await confirmAction({ title: text("rewards.confirm", { n, to: name }), ok: text("rewards.send") }))) return;
    setBusy(true); setMsg(null);
    try {
      const r = await api.sendCredits(name, n);
      setMsg({ ok: true, text: text("rewards.sent", { n: r.sent, to: r.to }) }); toast.success(text("rewards.sent", { n: r.sent, to: r.to })); setTo(""); setAmount("");
      void qc.invalidateQueries({ queryKey: ["credits"] }); void qc.invalidateQueries({ queryKey: ["my-marketing"] });
    } catch (err) { setMsg({ ok: false, text: errorMessage(err) }); } finally { setBusy(false); }
  }
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent"><Icon name="send" size={19} /></span>
        <div className="min-w-0">
          <Heading size="title" as="h2">{text("rewards.sendTitle")}</Heading>
          <p className="m-0 mt-1 text-[12.5px] text-muted">{s.on ? text("rewards.sendLine", { min: s.min, max: s.max, left }) : text("rewards.sendOff")}</p>
          {s.on && s.source === "extra" && <p className="m-0 mt-1 text-[12px] text-muted">{text("rewards.sendExtraOnly")}</p>}
        </div>
      </div>
      {s.on && (
        <form onSubmit={send} noValidate className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
          <Field label={text("rewards.to")}><Input value={to} onChange={(e) => setTo(e.target.value)} placeholder={text("rewards.toPlaceholder")} autoComplete="off" autoCapitalize="none" /></Field>
          <Field label={text("rewards.amount")}><Input type="number" inputMode="numeric" min={s.min} max={s.max} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(s.min)} /></Field>
          <Button type="submit" icon="send" loading={busy} disabled={!valid} className="sm:col-span-2">{busy ? text("rewards.sending") : text("rewards.send")}</Button>
          {msg && <p role="status" className={`m-0 text-[12.5px] sm:col-span-2 ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>}
        </form>
      )}
    </Card>
  );
}

function Username({ m }: { m: MyMarketing }) {
  const text = useText(), qc = useQueryClient();
  const [v, setV] = useState(m.username), [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const clean = v.trim().replace(/^@/, "").toLowerCase(), valid = /^[a-z0-9](?:[a-z0-9._]{1,18}[a-z0-9])$/.test(clean);
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!valid || clean === m.username) return;
    setBusy(true); setMsg(null);
    try { await api.setUsername(clean); setMsg({ ok: true, text: text("rewards.userSaved") }); toast.success(text("rewards.userSaved")); void qc.invalidateQueries({ queryKey: ["my-marketing"] }); void qc.invalidateQueries({ queryKey: ["me"] }); }
    catch (err) { setMsg({ ok: false, text: errorMessage(err) }); } finally { setBusy(false); }
  }
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent"><Icon name="user" size={19} /></span>
        <div className="min-w-0">
          <Heading size="title" as="h2">{text("rewards.userTitle")}</Heading>
          <p className="m-0 mt-1 text-[12.5px] text-muted">{text("rewards.userLine")}</p>
        </div>
      </div>
      <form onSubmit={save} noValidate className="flex gap-2">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-muted">@</span>
          <Input value={v.replace(/^@/, "")} onChange={(e) => { setV(e.target.value); setMsg(null); }} className="pl-7" autoCapitalize="none" autoComplete="off" aria-label={text("rewards.userTitle")} aria-invalid={!valid || undefined} />
        </div>
        <Button type="submit" variant="secondary" loading={busy} disabled={!valid || clean === m.username}>{text("rewards.userSave")}</Button>
      </form>
      {msg && <p role="status" className={`m-0 text-[12.5px] ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>}
    </Card>
  );
}

function Affiliate({ m }: { m: MyMarketing }) {
  const text = useText(), qc = useQueryClient(), a = m.affiliate, me = a.me;
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const apply = async () => { setBusy(true); setErr(null); try { await api.applyAffiliate(); void qc.invalidateQueries({ queryKey: ["my-marketing"] }); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); } };
  const rupee = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  return (
    <Card className="flex flex-col gap-4 p-5 md:p-6">
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent"><Icon name="coins" size={19} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Heading size="title" as="h2">{text("rewards.affTitle")}</Heading>
            {me && <Badge tone={me.status === "active" ? "success" : me.status === "pending" ? "warning" : "neutral"}>{me.status === "active" ? `${me.percent}%` : me.status}</Badge>}
          </div>
          <p className="m-0 mt-1 text-[12.5px] text-muted">{text("rewards.affLine", { percent: me?.percent ?? a.percent, months: me?.months ?? a.months })}</p>
          {me?.status === "active" && me.validUntil && (
            <p className="m-0 mt-1 text-[12px] font-semibold text-accent">{text("rewards.affUntil", { date: new Date(me.validUntil).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) })}</p>
          )}
        </div>
        {!me && a.applyOpen && <Button onClick={apply} loading={busy} icon="sparkle">{text("rewards.affApply")}</Button>}
      </div>
      {err && <p className="m-0 text-[12.5px] text-danger">{err}</p>}
      {!me && !a.applyOpen && <p className="m-0 text-[12.5px] text-muted">{text("rewards.affClosed")}</p>}
      {me?.status === "pending" && <p className="m-0 rounded-xl bg-surface-2 px-3 py-2.5 text-[12.5px] text-muted">{text("rewards.affPending")}</p>}
      {me?.status === "paused" && <p className="m-0 rounded-xl bg-surface-2 px-3 py-2.5 text-[12.5px] text-muted">{text("rewards.affPaused")}</p>}
      {me?.status === "active" && (
        <>
          <div className="grid gap-2.5 sm:grid-cols-3">
            <StatTile value={rupee(me.due)} label={text("rewards.affDue")} />
            <StatTile value={rupee(me.paid)} label={text("rewards.affPaid")} />
            <StatTile value={me.sales} label={text("rewards.affSales")} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="m-0 text-[12px] text-muted">{text("rewards.affPayout", { min: a.minPayout })}</p>
            <Button href="/affiliate" icon="trend" size="sm">{text("aff.open")}</Button>
          </div>
          {me.recent.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{text("rewards.affRecent")}</span>
              {me.recent.map((r, i) => (
                <div key={i} className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2 text-[12.5px]">
                  <span className="text-muted">{new Date(r.at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · {rupee(r.paid)}</span>
                  <b className="tabular-nums">+{rupee(r.commission)}</b>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
