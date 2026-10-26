"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Badge, Button, Heading, Icon, IconButton, Input, Select, Spinner, Toggle } from "@/components/atoms";
import { AffiliateView } from "@/components/organisms/AffiliateView";
import { ErrorBanner, Field, SidePanel, StatTile } from "@/components/molecules";
import { confirmAction } from "@/components/molecules/ConfirmDialog";
import type { AdminOffer, Coupon, MarketingSettings } from "@/lib/marketing";

/** Admin → Marketing: invite rewards, sending credits, the affiliate program, coupon codes, offers (sales) and how they
 * all do. Like Settings: a list of sections, each opening its form on the right. Every rule here is live for everyone. */
type Id = "referral" | "freeai" | "share" | "affiliates" | "coupons" | "offers" | "report";

const stepName = (s: string) => (s === "signup" ? "signs up" : s === "verified" ? "verifies their email" : "makes a first purchase");
const num = (v: string, d = 0) => (v === "" || Number.isNaN(Number(v)) ? d : Number(v));
const rupee = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");
const toInput = (s: string | null | undefined) => (s ? new Date(s).toISOString().slice(0, 16) : "");

export function MarketingTab() {
  const [open, setOpen] = useState<Id | null>(null);
  const q = useQuery({ queryKey: ["admin-marketing"], queryFn: api.adminMarketing });
  const coupons = useQuery({ queryKey: ["admin-coupons"], queryFn: api.coupons }).data?.coupons ?? [];
  const offers = useQuery({ queryKey: ["admin-offers"], queryFn: api.offers }).data?.offers ?? [];
  const affiliates = useQuery({ queryKey: ["admin-affiliates"], queryFn: api.affiliates }).data?.affiliates ?? [];
  if (q.error) return <ErrorBanner message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  const s = q.data?.settings, r = q.data?.report;
  const liveOffer = offers.find((o) => o.live), pending = affiliates.filter((a) => a.status === "pending").length;
  const sections: { id: Id; icon: string; title: string; line: string; badge?: { text: string; tone: "success" | "neutral" | "brand" | "warning" | "danger" } }[] = [
    { id: "referral", icon: "gift", title: "Invite rewards", line: s ? (s.referral.on ? `Friend ${s.referral.inviteeCredits} when they ${stepName(s.referral.inviteeOn)} · inviter ${s.referral.inviterCredits} when the friend ${stepName(s.referral.inviterOn)}` : "Turned off") : "…", badge: s && { text: s.referral.on ? "On" : "Off", tone: s.referral.on ? "success" : "neutral" } },
    { id: "freeai", icon: "wand", title: "Shubix AI on Free", line: s ? (s.ai.freeWithCredits ? "Free users pay for AI Reels and Ask Shubix with their credits" : "Free users keep their credits for when they upgrade") : "…", badge: s && { text: s.ai.freeWithCredits ? "With credits" : "Plans only", tone: s.ai.freeWithCredits ? "brand" : "neutral" } },
    { id: "share", icon: "send", title: "Sending credits", line: s ? (s.share.on ? `${s.share.min}–${s.share.max} a time · ${s.share.dailyMax} a day · ${s.share.source === "extra" ? "top-up & gift credits" : "all credits"}` : "Turned off") : "…", badge: s && { text: s.share.on ? "On" : "Off", tone: s.share.on ? "success" : "neutral" } },
    { id: "affiliates", icon: "coins", title: "Affiliate program", line: s ? `${affiliates.filter((a) => a.status === "active").length} active · default ${s.affiliate.percent}% for ${s.affiliate.months} months · ${rupee(r?.affiliates.due ?? 0)} due` : "…", badge: pending ? { text: `${pending} waiting`, tone: "warning" } : s && { text: s.affiliate.on ? "On" : "Off", tone: s.affiliate.on ? "success" : "neutral" } },
    { id: "coupons", icon: "tag", title: "Coupon codes", line: coupons.length ? coupons.slice(0, 4).map((c) => `${c.code} (${c.kind === "percent" ? `${c.value}%` : rupee(c.value)})`).join(" · ") : "No codes yet", badge: { text: `${coupons.filter((c) => c.live).length} live`, tone: "brand" } },
    { id: "offers", icon: "sparkle", title: "Offers & sales", line: liveOffer ? `Now: ${liveOffer.title} · ${liveOffer.percent}% off${liveOffer.ends ? ` until ${day(liveOffer.ends)}` : ""}` : offers.length ? "No sale running now" : "No offers yet", badge: liveOffer ? { text: "Live", tone: "success" } : undefined },
    { id: "report", icon: "trend", title: "Report", line: r ? `${r.referrals.last30} invites · ${r.coupons.uses30} coupons used · ${r.transfers.credits30} credits sent (30 days)` : "…" },
  ];
  const cur = sections.find((x) => x.id === open);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-2">
      <p className="m-0 mb-1 text-[12.5px] text-muted">Grow with invites, coupons and sales. Changes are live for everyone; every text people see is in the CMS (Invite & earn, Pricing).</p>
      {sections.map((x) => (
        <button key={x.id} type="button" onClick={() => setOpen(x.id)} aria-haspopup="dialog"
          className={cn("flex w-full items-center gap-3 rounded-2xl border bg-surface px-4 py-3.5 text-left shadow-[var(--shadow)] transition-colors md:px-5", open === x.id ? "border-accent" : "border-border hover:border-accent/50")}>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent"><Icon name={x.icon} size={19} /></span>
          <span className="min-w-0 flex-1">
            <Heading size="section" as="h2">{x.title}</Heading>
            <span className="block truncate text-[12.5px] text-muted">{x.line}</span>
          </span>
          {x.badge && <Badge tone={x.badge.tone}>{x.badge.text}</Badge>}
          <Icon name="chevron" size={18} className="shrink-0 text-muted" />
        </button>
      ))}
      <SidePanel open={!!cur} onClose={() => setOpen(null)} title={cur?.title ?? ""} where="Marketing" wide={open === "coupons" || open === "offers" || open === "affiliates"}>
        {s && open === "referral" && <ReferralForm s={s} />}
        {s && open === "share" && <ShareForm s={s} />}
        {s && open === "freeai" && <FreeAiForm s={s} />}
        {s && open === "affiliates" && <Affiliates s={s} />}
        {open === "coupons" && <Coupons list={coupons} />}
        {open === "offers" && <Offers list={offers} />}
        {r && open === "report" && <Report />}
      </SidePanel>
    </div>
  );
}

/** Save the whole marketing settings with one part changed. */
function useSaveSettings(s: MarketingSettings) {
  const qc = useQueryClient(), [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async (next: MarketingSettings) => {
    setBusy(true); setMsg(null);
    try { await api.setMarketing(next); setMsg({ ok: true, text: "Saved · live now" }); void qc.invalidateQueries({ queryKey: ["admin-marketing"] }); }
    catch (e) { setMsg({ ok: false, text: errorMessage(e) }); } finally { setBusy(false); }
  };
  return { save, busy, msg, s };
}
const Saved = ({ msg }: { msg: { ok: boolean; text: string } | null }) => msg && <p role="status" className={`m-0 text-[12.5px] ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>;

function ReferralForm({ s }: { s: MarketingSettings }) {
  const { save, busy, msg } = useSaveSettings(s), [v, setV] = useState(s.referral);
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void save({ ...s, referral: v }); }}>
      <Toggle label="Invite rewards on" hint="People share their link (/?ref=username); both get credits." on={v.on} onChange={(on) => setV({ ...v, on })} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Inviter gets (credits)"><Input type="number" min={0} value={v.inviterCredits} onChange={(e) => setV({ ...v, inviterCredits: num(e.target.value) })} /></Field>
        <Field label="Friend gets (credits)"><Input type="number" min={0} value={v.inviteeCredits} onChange={(e) => setV({ ...v, inviteeCredits: num(e.target.value) })} /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="The friend gets theirs when they…" hint="A welcome gift: verified email keeps fake emails out.">
          <Select value={v.inviteeOn} onChange={(e) => setV({ ...v, inviteeOn: e.target.value as typeof v.inviteeOn })}>
            <option value="signup">sign up</option><option value="verified">verify their email</option><option value="purchase">make a first purchase</option>
          </Select>
        </Field>
        <Field label="The inviter gets theirs when the friend…" hint="First purchase: paid for by real revenue, nothing to farm.">
          <Select value={v.inviterOn} onChange={(e) => setV({ ...v, inviterOn: e.target.value as typeof v.inviterOn })}>
            <option value="signup">signs up</option><option value="verified">verifies their email</option><option value="purchase">makes a first purchase</option>
          </Select>
        </Field>
      </div>
      <Field label="Rewarded invites per person a month" hint="Over it, the friend still gets theirs; 0 = no limit."><Input type="number" min={0} value={v.monthlyCap} onChange={(e) => setV({ ...v, monthlyCap: num(e.target.value) })} /></Field>
      <Saved msg={msg} />
      <Button type="submit" icon="check" loading={busy} className="self-end">Save</Button>
    </form>
  );
}

function FreeAiForm({ s }: { s: MarketingSettings }) {
  const { save, busy, msg } = useSaveSettings(s), [on, setOn] = useState(s.ai.freeWithCredits);
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void save({ ...s, ai: { freeWithCredits: on } }); }}>
      <Toggle label="Free users can spend credits on Shubix AI" hint="An AI Reel and Ask Shubix changes, charged as on Editor and Pro. Their credits come from invites, gifts and top-ups." on={on} onChange={setOn} />
      <ul className="m-0 flex list-none flex-col gap-1.5 rounded-2xl bg-surface-2 p-3.5 text-[12.5px] text-muted">
        <li><b className="text-foreground">On:</b> invite credits are worth something on Free (a taste of the AI), and when they run out people upgrade or top up.</li>
        <li><b className="text-foreground">Off:</b> Shubix AI stays Editor and Pro only; Free users keep their credits until they upgrade.</li>
        <li>Either way, captions, translation and the Editor / Pro tools stay with those plans.</li>
      </ul>
      <Saved msg={msg} />
      <Button type="submit" icon="check" loading={busy} className="self-end">Save</Button>
    </form>
  );
}

function ShareForm({ s }: { s: MarketingSettings }) {
  const { save, busy, msg } = useSaveSettings(s), [v, setV] = useState(s.share);
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void save({ ...s, share: v }); }}>
      <Toggle label="Sending credits on" hint="People send credits to a friend by @username (Invite & earn)." on={v.on} onChange={(on) => setV({ ...v, on })} />
      <div className="grid grid-cols-3 gap-3">
        <Field label="Smallest"><Input type="number" min={1} value={v.min} onChange={(e) => setV({ ...v, min: num(e.target.value, 1) })} /></Field>
        <Field label="Largest"><Input type="number" min={1} value={v.max} onChange={(e) => setV({ ...v, max: num(e.target.value, 1) })} /></Field>
        <Field label="A day (total)"><Input type="number" min={1} value={v.dailyMax} onChange={(e) => setV({ ...v, dailyMax: num(e.target.value, 1) })} /></Field>
      </div>
      <Field label="Which credits can be sent">
        <Select value={v.source} onChange={(e) => setV({ ...v, source: e.target.value as typeof v.source })}>
          <option value="extra">{"Top-up and gift credits only (a plan's monthly credits stay)"}</option><option value="all">All credits</option>
        </Select>
      </Field>
      <Saved msg={msg} />
      <Button type="submit" icon="check" loading={busy} className="self-end">Save</Button>
    </form>
  );
}

function Affiliates({ s }: { s: MarketingSettings }) {
  const { save, busy, msg } = useSaveSettings(s), [v, setV] = useState(s.affiliate);
  const list = useQuery({ queryKey: ["admin-affiliates"], queryFn: api.affiliates }).data?.affiliates ?? [];
  const [pick, setPick] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-5">
      {pick && <Partner id={pick} s={s} onClose={() => setPick(null)} />}
      <form className="flex flex-col gap-4 rounded-2xl border border-border bg-surface-2 p-4" onSubmit={(e) => { e.preventDefault(); void save({ ...s, affiliate: v }); }}>
        <Toggle label="Affiliate program on" hint="Partners earn a % of what the people they bring pay." on={v.on} onChange={(on) => setV({ ...v, on })} />
        <Toggle label="Open for new partners" hint="People can ask to join from Invite & earn; you approve them below." on={v.applyOpen} onChange={(applyOpen) => setV({ ...v, applyOpen })} />
        <div className="grid grid-cols-3 gap-3">
          <Field label="Default %"><Input type="number" min={0} max={90} value={v.percent} onChange={(e) => setV({ ...v, percent: num(e.target.value) })} /></Field>
          <Field label="For (months)"><Input type="number" min={1} value={v.months} onChange={(e) => setV({ ...v, months: num(e.target.value, 1) })} /></Field>
          <Field label="Payout from (₹)"><Input type="number" min={0} value={v.minPayout} onChange={(e) => setV({ ...v, minPayout: num(e.target.value) })} /></Field>
        </div>
        <Saved msg={msg} />
        <Button type="submit" icon="check" loading={busy} className="self-end">Save</Button>
      </form>
      <div className="flex flex-col gap-2">
        <Heading size="section" as="h3">Partners ({list.length})</Heading>
        {!list.length && <p className="m-0 text-[12.5px] text-muted">No one yet. People ask to join from Invite & earn.</p>}
        {list.map((a) => (
          <button key={a.id} type="button" onClick={() => setPick(a.id)}
            className="flex w-full items-center gap-3 rounded-2xl border border-border bg-surface p-3 text-left transition-colors hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--border))] hover:bg-surface-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2"><b className="truncate text-[13.5px]">@{a.username || "—"}</b><Badge tone={a.status === "active" ? "success" : a.status === "pending" ? "warning" : "neutral"}>{a.status}</Badge></div>
              <span className="block truncate text-[12px] text-muted">{a.email} · {a.percent}% · brought {a.brought} · {a.sales} sales · due {rupee(a.due)} · paid {rupee(a.paid)}{a.validUntil ? ` · link until ${day(a.validUntil)}` : ""}</span>
            </div>
            {a.due > 0 && <Badge tone="warning">{rupee(a.due)} due</Badge>}
            <Icon name="chevron" size={16} className="shrink-0 text-muted" />
          </button>
        ))}
      </div>
    </div>
  );
}

/** One partner, everything (a pop-up over the panel): their link, terms, numbers, customers, sales, payouts, and their own
 * terms to change. Every action asks first. */
function Partner({ id, s, onClose }: { id: string; s: MarketingSettings; onClose: () => void }) {
  const qc = useQueryClient(), q = useQuery({ queryKey: ["admin-affiliate", id], queryFn: () => api.affiliate(id) }), a = q.data;
  const [form, setForm] = useState<{ percent: string; months: string; until: string } | null>(null), [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (a && !form) void Promise.resolve().then(() => setForm({ percent: String(a.percent), months: a.monthsOwn ? String(a.monthsOwn) : "", until: dateOnly(a.validUntil) })); }, [a, form]);
  useEffect(() => {
    // Esc closes this pop-up only (not the panel under it)
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  const act = async (ask: Parameters<typeof confirmAction>[0], f: () => Promise<unknown>) => {
    if (!(await confirmAction(ask))) return;
    setBusy(true); setErr(null);
    try { await f(); await Promise.all([q.refetch(), qc.invalidateQueries({ queryKey: ["admin-affiliates"] }), qc.invalidateQueries({ queryKey: ["admin-marketing"] })]); setForm(null); }
    catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  const who = a ? `@${a.username}` : "";
  const terms = form && a ? { percent: num(form.percent, a.percent), months: num(form.months, 0), validUntil: form.until ? new Date(form.until + "T23:59:59").toISOString() : null } : null;
  const changed = !!(terms && a && (terms.percent !== a.percent || terms.months !== (a.monthsOwn ?? 0) || form?.until !== dateOnly(a.validUntil)));
  const dueSales = a ? a.sales.filter((x) => x.status === "due").length : 0;
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-end sm:place-items-center sm:p-6" role="dialog" aria-modal="true" aria-label={who || "Partner"}>
      <div className="absolute inset-0 bg-[var(--overlay)] backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative flex max-h-[92vh] w-full animate-sheet flex-col overflow-hidden rounded-t-3xl border border-border bg-background shadow-2xl sm:max-w-[760px] sm:rounded-3xl">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="m-0 truncate text-[12px] text-muted">Affiliate partner{a?.email ? ` · ${a.email}` : ""}{a?.since ? ` · since ${day(a.since)}` : ""}</p>
            <Heading className="truncate">{who || "…"}</Heading>
          </div>
          {a && <Badge tone={a.status === "active" ? "success" : a.status === "pending" ? "warning" : "neutral"}>{a.status}</Badge>}
          <IconButton icon="close" label="Close" onClick={onClose} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-surface-2/40 p-4 md:p-5">
          {q.isLoading && <Spinner />}
          {q.error && <ErrorBanner message={errorMessage(q.error)} onRetry={() => void q.refetch()} />}
          {err && <ErrorBanner message={err} />}
          {a && form && terms && (
            <>
              <AffiliateView a={a} admin />
              <form className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4"
                onSubmit={(e) => { e.preventDefault(); void act({ title: `Change ${who}'s terms?`, body: `${terms.percent}% commission · ${terms.months || s.affiliate.months} months per customer${terms.months ? "" : " (the program's)"} · link ${terms.validUntil ? `valid until ${day(terms.validUntil)}` : "with no end date"}. Sales already made keep their commission.`, ok: "Save terms" }, () => api.updateAffiliate({ id, ...terms })); }}>
                <Heading size="section" as="h3">Their terms</Heading>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Commission %"><Input type="number" min={0} max={90} value={form.percent} onChange={(e) => setForm({ ...form, percent: e.target.value })} /></Field>
                  <Field label="Months per customer" hint={`Empty: the program's (${s.affiliate.months})`}><Input type="number" min={0} max={120} value={form.months} placeholder={String(s.affiliate.months)} onChange={(e) => setForm({ ...form, months: e.target.value })} /></Field>
                  <Field label="Link valid until" hint="Empty: no end date"><Input type="date" value={form.until} onChange={(e) => setForm({ ...form, until: e.target.value })} /></Field>
                </div>
                <Button type="submit" icon="check" size="sm" disabled={!changed || busy} className="self-end">Save terms</Button>
              </form>
            </>
          )}
        </div>
        {a && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-[var(--bar)] px-5 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
            {a.status !== "active" && <Button size="sm" icon="check" loading={busy}
              onClick={() => void act({ title: `${a.status === "pending" ? "Approve" : "Resume"} ${who}?`, body: `Their link earns ${a.percent}% of what the people they bring pay.`, ok: a.status === "pending" ? "Approve" : "Resume" }, () => api.updateAffiliate({ id, status: "active" }))}>{a.status === "pending" ? "Approve" : "Resume"}</Button>}
            {a.status === "active" && <Button size="sm" variant="secondary" loading={busy}
              onClick={() => void act({ title: `Pause ${who}?`, body: "Their sales earn no commission while paused. What is already due stays due.", ok: "Pause", danger: true }, () => api.updateAffiliate({ id, status: "paused" }))}>Pause</Button>}
            {a.stats.due > 0 && <Button size="sm" icon="coins" loading={busy}
              onClick={() => void act({ title: `Mark ${rupee(a.stats.due)} paid to ${who}?`, body: `Pay them by bank or UPI first; this marks their ${dueSales} due sale${dueSales === 1 ? "" : "s"} as paid.${a.stats.due < a.minPayout ? ` (Below the ₹${a.minPayout} payout minimum.)` : ""}`, ok: "Mark paid" }, () => api.payAffiliate(id, ""))}>Mark {rupee(a.stats.due)} paid</Button>}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
const dateOnly = (d: string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "");

const emptyCoupon = (): Omit<Coupon, "uses" | "live"> => ({ code: "", kind: "percent", value: 10, appliesTo: "all", audience: "all", minAmount: 0, maxUses: 0, perUserOnce: true, starts: null, ends: null, active: true, note: "" });
function Coupons({ list }: { list: Coupon[] }) {
  const qc = useQueryClient(), [edit, setEdit] = useState<Omit<Coupon, "uses" | "live"> | null>(null), [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!edit) return; setBusy(true); setErr(null);
    try { await api.saveCoupon({ ...edit, starts: edit.starts || null, ends: edit.ends || null }); setEdit(null); void qc.invalidateQueries({ queryKey: ["admin-coupons"] }); }
    catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  const del = async (c: Coupon) => { if (await confirmAction({ title: `Delete the code ${c.code}?`, body: "People can no longer use it.", ok: "Delete", danger: true })) { await api.deleteCoupon(c.code); void qc.invalidateQueries({ queryKey: ["admin-coupons"] }); } };
  return (
    <div className="flex flex-col gap-3">
      {!edit && <Button icon="plus" onClick={() => setEdit(emptyCoupon())} className="self-start">New code</Button>}
      {edit && (
        <form className="flex flex-col gap-3 rounded-2xl border border-accent/40 bg-surface-2 p-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Code"><Input value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "") })} placeholder="DIWALI20" className="font-mono" required /></Field>
            <Field label="Type"><Select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as Coupon["kind"] })}><option value="percent">% off</option><option value="flat">₹ off</option></Select></Field>
            <Field label={edit.kind === "percent" ? "Percent" : "Rupees"}><Input type="number" min={1} max={edit.kind === "percent" ? 90 : 100000} value={edit.value} onChange={(e) => setEdit({ ...edit, value: num(e.target.value, 1) })} /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="For"><Select value={edit.appliesTo} onChange={(e) => setEdit({ ...edit, appliesTo: e.target.value as Coupon["appliesTo"] })}><option value="all">Plans and top-ups</option><option value="plans">Plans only</option><option value="topups">Top-ups only</option></Select></Field>
            <Field label="Who"><Select value={edit.audience} onChange={(e) => setEdit({ ...edit, audience: e.target.value as Coupon["audience"] })}><option value="all">Everyone</option><option value="new">First purchase only</option></Select></Field>
            <Field label="Minimum purchase (₹)"><Input type="number" min={0} value={edit.minAmount} onChange={(e) => setEdit({ ...edit, minAmount: num(e.target.value) })} /></Field>
            <Field label="Total uses (0 = no limit)"><Input type="number" min={0} value={edit.maxUses} onChange={(e) => setEdit({ ...edit, maxUses: num(e.target.value) })} /></Field>
            <Field label="Starts (optional)"><Input type="datetime-local" value={toInput(edit.starts)} onChange={(e) => setEdit({ ...edit, starts: e.target.value ? new Date(e.target.value).toISOString() : null })} /></Field>
            <Field label="Ends (optional)"><Input type="datetime-local" value={toInput(edit.ends)} onChange={(e) => setEdit({ ...edit, ends: e.target.value ? new Date(e.target.value).toISOString() : null })} /></Field>
          </div>
          <Toggle label="Once per person" on={edit.perUserOnce} onChange={(perUserOnce) => setEdit({ ...edit, perUserOnce })} />
          <Toggle label="Active" on={edit.active} onChange={(active) => setEdit({ ...edit, active })} />
          <Field label="Note (only you see it)"><Input value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} placeholder="Instagram campaign, Oct" /></Field>
          {err && <ErrorBanner message={err} />}
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button type="submit" icon="check" loading={busy} disabled={edit.code.length < 3}>Save code</Button></div>
        </form>
      )}
      {list.map((c) => (
        <div key={c.code} className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface p-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent"><Icon name="tag" size={17} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><b className="font-mono text-[14px]">{c.code}</b><Badge tone="brand">{c.kind === "percent" ? `${c.value}% off` : `${rupee(c.value)} off`}</Badge><Badge tone={c.live ? "success" : "neutral"}>{c.live ? "Live" : c.active ? "Not in dates" : "Off"}</Badge></div>
            <span className="block truncate text-[12px] text-muted">{c.appliesTo === "all" ? "Plans & top-ups" : c.appliesTo === "plans" ? "Plans" : "Top-ups"}{c.audience === "new" ? " · first purchase" : ""} · used {c.uses}{c.maxUses ? ` of ${c.maxUses}` : ""}{c.minAmount ? ` · min ₹${c.minAmount}` : ""}{c.ends ? ` · until ${day(c.ends)}` : ""}{c.note ? ` · ${c.note}` : ""}</span>
          </div>
          <Button size="sm" variant="secondary" icon="pen" onClick={() => setEdit({ code: c.code, kind: c.kind, value: c.value, appliesTo: c.appliesTo, audience: c.audience, minAmount: c.minAmount ?? 0, maxUses: c.maxUses ?? 0, perUserOnce: c.perUserOnce !== false, starts: c.starts, ends: c.ends, active: c.active !== false, note: c.note ?? "" })}>Edit</Button>
          <Button size="sm" variant="secondary" icon="trash" aria-label={`Delete ${c.code}`} onClick={() => void del(c)} />
        </div>
      ))}
    </div>
  );
}

function Offers({ list }: { list: AdminOffer[] }) {
  const qc = useQueryClient(), [edit, setEdit] = useState<Partial<AdminOffer> | null>(null), [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!edit) return; setBusy(true); setErr(null);
    try { await api.saveOffer({ ...edit, starts: edit.starts || null, ends: edit.ends || null }); setEdit(null); void qc.invalidateQueries({ queryKey: ["admin-offers"] }); void qc.invalidateQueries({ queryKey: ["offer"] }); }
    catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  const del = async (o: AdminOffer) => { if (await confirmAction({ title: `Delete "${o.title}"?`, ok: "Delete", danger: true })) { await api.deleteOffer(o.id); void qc.invalidateQueries({ queryKey: ["admin-offers"] }); void qc.invalidateQueries({ queryKey: ["offer"] }); } };
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-[12.5px] text-muted">A sale shows on the pricing page (struck-through prices) and as a slim bar across the app. When two run at once, the bigger one counts.</p>
      {!edit && <Button icon="plus" onClick={() => setEdit({ title: "", banner: "", percent: 20, appliesTo: "all", audience: "all", starts: null, ends: null, active: true })} className="self-start">New offer</Button>}
      {edit && (
        <form className="flex flex-col gap-3 rounded-2xl border border-accent/40 bg-surface-2 p-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
            <Field label="Name"><Input value={edit.title ?? ""} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="Diwali sale" required /></Field>
            <Field label="Percent off"><Input type="number" min={1} max={90} value={edit.percent ?? 20} onChange={(e) => setEdit({ ...edit, percent: num(e.target.value, 1) })} /></Field>
          </div>
          <Field label="Banner line (optional)"><Input value={edit.banner ?? ""} onChange={(e) => setEdit({ ...edit, banner: e.target.value })} placeholder="Light up your Reels this festive season" /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="For"><Select value={edit.appliesTo ?? "all"} onChange={(e) => setEdit({ ...edit, appliesTo: e.target.value as AdminOffer["appliesTo"] })}><option value="all">Plans and top-ups</option><option value="plans">Plans only</option><option value="topups">Top-ups only</option></Select></Field>
            <Field label="Who"><Select value={edit.audience ?? "all"} onChange={(e) => setEdit({ ...edit, audience: e.target.value as AdminOffer["audience"] })}><option value="all">Everyone</option><option value="new">First purchase only</option></Select></Field>
            <Field label="Starts (optional)"><Input type="datetime-local" value={toInput(edit.starts)} onChange={(e) => setEdit({ ...edit, starts: e.target.value ? new Date(e.target.value).toISOString() : null })} /></Field>
            <Field label="Ends (optional)"><Input type="datetime-local" value={toInput(edit.ends)} onChange={(e) => setEdit({ ...edit, ends: e.target.value ? new Date(e.target.value).toISOString() : null })} /></Field>
          </div>
          <Toggle label="Active" on={edit.active !== false} onChange={(active) => setEdit({ ...edit, active })} />
          {err && <ErrorBanner message={err} />}
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button type="submit" icon="check" loading={busy} disabled={!(edit.title ?? "").trim()}>Save offer</Button></div>
        </form>
      )}
      {list.map((o) => (
        <div key={o.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface p-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[image:var(--gold-gradient)] text-white"><Icon name="sparkle" size={16} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><b className="text-[14px]">{o.title}</b><Badge tone="brand">{o.percent}% off</Badge><Badge tone={o.live ? "success" : "neutral"}>{o.live ? "Live" : o.active ? "Not in dates" : "Off"}</Badge></div>
            <span className="block truncate text-[12px] text-muted">{o.appliesTo === "all" ? "Plans & top-ups" : o.appliesTo === "plans" ? "Plans" : "Top-ups"}{o.audience === "new" ? " · first purchase" : ""}{o.starts ? ` · from ${day(o.starts)}` : ""}{o.ends ? ` · until ${day(o.ends)}` : ""}{o.banner ? ` · “${o.banner}”` : ""}</span>
          </div>
          <Button size="sm" variant="secondary" icon="pen" onClick={() => setEdit({ ...o })}>Edit</Button>
          <Button size="sm" variant="secondary" icon="trash" aria-label={`Delete ${o.title}`} onClick={() => void del(o)} />
        </div>
      ))}
    </div>
  );
}

function Report() {
  const q = useQuery({ queryKey: ["admin-marketing"], queryFn: api.adminMarketing }), r = q.data?.report;
  const [, tick] = useState(0); useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 60_000); return () => clearInterval(i); }, []);
  if (!r) return null;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <StatTile value={r.referrals.last30} label="Invites (30 days)" icon="gift" note={`${r.referrals.total} in all · ${r.referrals.rewarded} rewarded`} />
        <StatTile value={r.coupons.uses30} label="Coupons used (30 days)" icon="tag" note={`${rupee(r.coupons.discount30)} off`} />
        <StatTile value={r.transfers.credits30} label="Credits sent (30 days)" icon="send" note={`${r.transfers.count30} sends`} />
        <StatTile value={rupee(r.affiliates.due)} label="Affiliates: due" icon="coins" />
        <StatTile value={rupee(r.affiliates.paid)} label="Affiliates: paid" icon="check" />
      </div>
      <div className="flex flex-col gap-2">
        <Heading size="section" as="h3">Top inviters</Heading>
        {!r.topInviters.length && <p className="m-0 text-[12.5px] text-muted">No invites yet.</p>}
        {r.topInviters.map((u, i) => (
          <div key={i} className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2 text-[13px]">
            <span className="min-w-0 truncate"><b>@{u.username || "—"}</b> <span className="text-muted">{u.email}</span></span>
            <b className="tabular-nums">{u.invited}</b>
          </div>
        ))}
      </div>
    </div>
  );
}
