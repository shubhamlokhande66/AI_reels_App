"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useSafeQuery as useQuery } from "@/lib/useSafeQuery";
import { api, errorMessage } from "@/lib/api";
import { useText } from "@/hooks/useApi";
import { useCountdown } from "@/lib/useCountdown";
import { emailOk, maskEmail } from "@/lib/validate";
import { Badge, Button, Card, Heading, Icon, Input, LogoTile, Spinner } from "@/components/atoms";
import { EmptyState, ErrorBanner, Field, PageHeader, Segmented } from "@/components/molecules";
import { confirmAction } from "@/components/molecules/ConfirmDialog";
import { OtpInput } from "@/components/molecules/OtpInput";
import type { AffiliateDetail, PartnerMe, PayoutInput } from "@/lib/marketing";
import { AffiliateView, dayOf } from "@/components/organisms/AffiliateView";

const KEY = ["partner-me"];

/** The affiliate partner dashboard: its own page (no studio around it), for Shubix users and for people who only want
 * the affiliate program. Signed in to Shubix: straight in. Otherwise: email → 6-digit code → in (30 days; ?email= from
 * the approval email fills it in). Then: ask to join (the administrator approves, an email says so), and once active
 * their link and terms, clicks, customers (usernames only), sales, payouts. Every word: Admin → CMS → Affiliate dashboard. */
export default function AffiliatePage() {
  return <Suspense fallback={<Spinner />}><Partner /></Suspense>;
}

function Partner() {
  const text = useText();
  const q = useQuery({ queryKey: KEY, queryFn: api.partnerMe, retry: false });
  const d = q.data;
  // cash payouts are on the website only: in the Play app they make the app rated 18+ (content rating, cash rewards)
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-5xl flex-col gap-5 px-4 pb-10 pt-[max(16px,env(safe-area-inset-top))] md:px-6">
      <TopBar me={d} />
      {q.isLoading ? <Spinner label={text("aff.loading")} />
        : q.error ? <ErrorBanner message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
        : d && <Body me={d} />}
    </div>
  );
}

/** the brand, and the way out: back to the studio (a Shubix user) or sign out (a partner-only session) */
function TopBar({ me }: { me?: PartnerMe }) {
  const text = useText(), qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const out = async () => { setBusy(true); try { await api.partnerLogout(); await qc.invalidateQueries({ queryKey: KEY }); } finally { setBusy(false); } };
  return (
    <header className="flex items-center justify-between gap-3">
      <LogoTile height={40} />
      <div className="flex min-w-0 items-center gap-2">
        {me?.email && <span className="hidden truncate text-[12.5px] text-muted sm:inline">{me.email}</span>}
        {me?.via === "shubix" && <Button href="/" size="sm" variant="secondary" icon="back">{text("aff.toShubix")}</Button>}
        {me?.via === "partner" && <Button size="sm" variant="ghost" loading={busy} onClick={() => void out()}>{text("aff.signOut")}</Button>}
      </div>
    </header>
  );
}

function Body({ me }: { me: PartnerMe }) {
  const text = useText(), qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: KEY });
  if (!me.via) return <SignIn program={me.program} onIn={refresh} />;
  const a = me.affiliate;
  if (!a) {
    if (!me.program.on || !me.program.applyOpen) return <Narrow><EmptyState icon="coins" title={text("aff.closed")} /></Narrow>;
    return <Apply me={me} onSent={refresh} />;
  }
  if (a.status !== "active")
    return (
      <Narrow>
        <EmptyState icon="coins" title={text(a.status === "pending" ? "aff.pendingTitle" : "aff.pausedTitle")} hint={text(a.status === "pending" ? "aff.pendingLine" : "rewards.affPaused")} />
      </Narrow>
    );
  return (
    <>
      <PageHeader title={text("nav.affiliate")} subtitle={text("aff.sub")} />
      <div className="-mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
        <Badge tone="success">@{a.username}</Badge>
        {a.since && <span>· {dayOf(a.since)}</span>}
      </div>
      <PayoutCard a={a} onSaved={refresh} />
      <AffiliateView a={a} />
    </>
  );
}

const Narrow = ({ children }: { children: React.ReactNode }) => <div className="mx-auto mt-6 flex w-full max-w-[420px] flex-col gap-4">{children}</div>;

/** Signed out: their email (filled in from ?email=), a code to it, and in. */
function SignIn({ program, onIn }: { program: PartnerMe["program"]; onIn: () => void }) {
  const text = useText(), params = useSearchParams();
  const [email, setEmail] = useState(params.get("email") ?? ""), [sent, setSent] = useState(false), [code, setCode] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [note, setNote] = useState<string | null>(null);
  const wait = useCountdown(0);
  const send = async (e?: React.FormEvent) => {
    e?.preventDefault(); setError(null); setNote(null);
    if (!emailOk(email)) return setError(text("auth.badEmail"));
    setBusy(true);
    try { const r = await api.partnerCode(email.trim()); wait.start(r.wait ?? 60); if (sent) setNote(text("auth.codeResent")); setSent(true); }
    catch (x) { setError(errorMessage(x)); } finally { setBusy(false); }
  };
  const verify = async (c = code) => {
    if (c.length !== 6 || busy) return;
    setBusy(true); setError(null);
    try { await api.partnerVerify(email.trim(), c); onIn(); } catch (x) { setError(errorMessage(x)); setCode(""); } finally { setBusy(false); }
  };
  return (
    <Narrow>
      <Card className="flex flex-col gap-4 p-6">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent/12 text-accent"><Icon name="coins" size={20} /></span>
        <div>
          <Heading size="title" as="h1">{text(sent ? "aff.codeTitle" : "aff.signTitle")}</Heading>
          <p className="m-0 mt-1 text-[13px] text-muted">{sent ? text("auth.codeSentTo", { email: maskEmail(email.trim()) }) : text("aff.signLine", { percent: program.percent, months: program.months })}</p>
        </div>
        {!sent ? (
          <form onSubmit={send} noValidate className="flex flex-col gap-4"><fieldset disabled={busy} className="contents">
            <Field label={text("auth.email")}>
              <Input type="email" autoComplete="email" placeholder={text("auth.emailPlaceholder")} value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }} />
            </Field>
            {error && <ErrorBanner message={error} />}
            <Button type="submit" size="lg" loading={busy} disabled={!emailOk(email)}>{text("aff.sendCode")}</Button>
          </fieldset></form>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void verify(); }}><fieldset disabled={busy} className="contents">
            <OtpInput label={text("auth.codeLabel")} value={code} onChange={(v) => { setCode(v); setError(null); }} onComplete={(v) => void verify(v)} invalid={!!error} disabled={busy} />
            {error && <ErrorBanner message={error} />}
            {note && !error && <p className="m-0 text-[12.5px] font-semibold text-success">{note}</p>}
            <Button type="submit" loading={busy} disabled={code.length !== 6}>{text("auth.verifyButton")}</Button>
            <p className="m-0 text-center text-[12.5px] text-muted">
              {text("auth.noCode")}{" "}
              {wait.left > 0 ? <span>{text("auth.resendIn", { s: wait.left })}</span>
                : <button type="button" className="font-bold text-accent" onClick={() => void send()}>{text("auth.resendCode")}</button>}
            </p>
            <p className="m-0 text-center text-[11.5px] text-muted">{text("auth.checkSpam")}</p>
            <button type="button" className="text-[12.5px] font-bold text-muted hover:text-foreground" onClick={() => { setSent(false); setCode(""); setError(null); setNote(null); }}>{text("aff.otherEmail")}</button>
          </fieldset></form>
        )}
      </Card>
      <p className="m-0 text-center text-[12.5px] text-muted">{text("aff.haveShubix")} <Link href="/login" className="font-bold text-accent">{text("aff.signInShubix")}</Link></p>
    </Narrow>
  );
}

/** Signed in, not in the program yet: ask to join (their email is the one they signed in with). */
function Apply({ me, onSent }: { me: PartnerMe; onSent: () => void }) {
  const text = useText();
  const [note, setNote] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await api.partnerApply(note.trim()); onSent(); } catch (x) { setErr(errorMessage(x)); } finally { setBusy(false); }
  };
  return (
    <Narrow>
      <Card className="flex flex-col gap-4 p-6">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent/12 text-accent"><Icon name="sparkle" size={20} /></span>
        <div>
          <Heading size="title" as="h1">{text("aff.applyTitle")}</Heading>
          <p className="m-0 mt-1 text-[13px] text-muted">{text("aff.signLine", { percent: me.program.percent, months: me.program.months })}</p>
        </div>
        <form onSubmit={send} className="flex flex-col gap-4"><fieldset disabled={busy} className="contents">
          <Field label={text("auth.email")} hint={text("aff.applyAs", { email: me.email ?? "" })}><Input value={me.email ?? ""} readOnly disabled /></Field>
          <Field label={text("aff.noteLabel")}><Input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder={text("aff.notePlaceholder")} /></Field>
          {err && <ErrorBanner message={err} />}
          <Button type="submit" size="lg" icon="sparkle" loading={busy}>{text("aff.applyButton")}</Button>
        </fieldset></form>
      </Card>
    </Narrow>
  );
}

const where = (p: NonNullable<AffiliateDetail["payout"]>) => (p.method === "upi" ? p.upi : `${p.name} · ${p.account} · ${p.ifsc}`);

/** Where the affiliate is paid: a UPI ID or a bank account (asked first; the account number shows its last 4 only). */
function PayoutCard({ a, onSaved }: { a: AffiliateDetail; onSaved: () => void }) {
  const text = useText(), p = a.payout;
  const [edit, setEdit] = useState(!p), [method, setMethod] = useState<"upi" | "bank">(p?.method ?? "upi");
  const [upi, setUpi] = useState(p?.method === "upi" ? p.upi : ""), [name, setName] = useState(p?.method === "bank" ? p.name : "");
  const [account, setAccount] = useState(""), [ifsc, setIfsc] = useState(p?.method === "bank" ? p.ifsc : "");
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null), [done, setDone] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setDone(false);
    const d: PayoutInput = method === "upi" ? { method, upi: upi.trim() } : { method, name: name.trim(), account: account.replace(/\s/g, ""), ifsc: ifsc.trim().toUpperCase() };
    const shown = d.method === "upi" ? d.upi : `${d.name} · ${d.account} · ${d.ifsc}`;
    if (!(await confirmAction({ title: text("aff.payConfirm", { where: shown }), ok: text("aff.paySave") }))) return;
    setBusy(true);
    try { await api.partnerPayout(d); setDone(true); setEdit(false); setAccount(""); onSaved(); } catch (x) { setErr(errorMessage(x)); } finally { setBusy(false); }
  };
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Heading size="section" as="h2">{text("aff.payTitle")}</Heading>
          <p className="m-0 mt-0.5 text-[12.5px] text-muted">{p ? text("aff.paySub") : text("aff.payMissing")}</p>
        </div>
        {p && !edit && <Button size="sm" variant="secondary" icon="pen" onClick={() => setEdit(true)}>{text("aff.payEdit")}</Button>}
      </div>
      {p && !edit && <p className="m-0 flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-[13px]"><Icon name="check" size={14} className="text-success" />{text("aff.payNow", { where: where(p) })}</p>}
      {done && !edit && <p className="m-0 text-[12.5px] font-semibold text-success">{text("aff.paySaved")}</p>}
      {edit && (
        <form onSubmit={save} className="flex flex-col gap-3"><fieldset disabled={busy} className="contents">
          <Segmented label={text("aff.payTitle")} value={method} onChange={(v) => setMethod(v as "upi" | "bank")} className="self-start"
            options={[{ value: "upi", label: text("aff.payUpi") }, { value: "bank", label: text("aff.payBank") }]} />
          {method === "upi" ? (
            <Field label={text("aff.upiLabel")} hint={text("aff.upiHint")}><Input value={upi} onChange={(e) => setUpi(e.target.value)} autoComplete="off" inputMode="email" placeholder="name@bank" required /></Field>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={text("aff.bankName")}><Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required /></Field>
              <Field label={text("aff.bankAccount")}><Input value={account} onChange={(e) => setAccount(e.target.value)} inputMode="numeric" autoComplete="off" required
                placeholder={p?.method === "bank" ? text("aff.bankAccountKeep", { last4: p.account.slice(-4) }) : ""} /></Field>
              <Field label={text("aff.bankIfsc")}><Input value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase())} autoComplete="off" placeholder="SBIN0001234" required /></Field>
            </div>
          )}
          {err && <ErrorBanner message={err} />}
          <div className="flex justify-end gap-2">
            {p && <Button type="button" variant="ghost" size="sm" onClick={() => { setEdit(false); setErr(null); }}>{text("common.cancel")}</Button>}
            <Button type="submit" size="sm" icon="check" loading={busy}>{text("aff.paySave")}</Button>
          </div>
        </fieldset></form>
      )}
    </Card>
  );
}
