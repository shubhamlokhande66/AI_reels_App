"use client";

import { toast } from "@/lib/toast";
import { useState } from "react";
import { ThemeChoice } from "@/components/molecules/ThemeToggle";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useCredits, useMe, useText } from "@/hooks/useApi";
import { Avatar, Badge, Button, Card, Heading, Icon, Input, Spinner } from "@/components/atoms";
import { ErrorBanner, Field, PageHeader, PasswordInput, SidePanel } from "@/components/molecules";
import { passwordOk } from "@/lib/validate";
import { AdSlot } from "@/components/organisms/AdSlot";
import { useSafeQuery } from "@/lib/useSafeQuery";

const day = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

function ChangePassword({ email, onDone }: { email: string; onDone: () => void }) {
  const text = useText();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!current) return setMsg({ ok: false, text: text("account.errCurrent") });
    if (!passwordOk(next)) return setMsg({ ok: false, text: text("account.errShort") });
    if (next !== again) return setMsg({ ok: false, text: text("account.errMismatch") });
    if (next === current) return setMsg({ ok: false, text: text("account.errSame") });
    setBusy(true);
    try {
      await api.changePassword(current, next);
      setCurrent(""); setNext(""); setAgain("");
      setMsg({ ok: true, text: text("account.updated") }); toast.success(text("account.updated"));
      setTimeout(onDone, 1500);
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" aria-label={text("account.changeTitle")}>
      <Card className="flex flex-col gap-3">
        <Field label={text("auth.email")}><Input value={email} disabled readOnly /></Field>
        <Field label={text("account.current")}><PasswordInput autoComplete="current-password" placeholder="••••••••" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={text("account.newPassword")} hint={text("auth.lengthHint")} error={next && !passwordOk(next) ? text("account.errShort") : next && next === current ? text("account.errSame") : ""} ok={passwordOk(next) && next !== current ? text("auth.strongEnough") : ""}>
            <PasswordInput autoComplete="new-password" placeholder={text("auth.newPasswordPlaceholder")} value={next} invalid={!!next && (!passwordOk(next) || next === current)} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label={text("account.confirmNew")} error={again && again !== next ? text("account.errMismatch") : ""} ok={again && again === next ? text("auth.match") : ""}>
            <PasswordInput autoComplete="new-password" placeholder={text("auth.confirmPlaceholder")} value={again} invalid={!!again && again !== next} onChange={(e) => setAgain(e.target.value)} />
          </Field>
        </div>
      </Card>
      {msg && <p className={cn("m-0 rounded-xl border px-3 py-2 text-[13px] font-semibold", msg.ok ? "border-success/40 bg-success/10 text-success" : "border-danger/40 bg-danger/10 text-danger")}>{msg.text}</p>}
      <Button type="submit" icon="check" loading={busy} disabled={!current || !passwordOk(next) || next === current || again !== next} className="self-end">{busy ? text("account.saving") : text("account.update")}</Button>
    </form>
  );
}

function Sessions() {
  const text = useText();
  const qc = useQueryClient();
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <Card className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-success/15 text-success"><Icon name="check" size={18} /></span>
        <span className="min-w-0 flex-1"><b className="block text-[14px]">{text("account.thisDevice")}</b><span className="text-[12.5px] text-muted">{text("account.sessionsTitle")}</span></span>
        <Badge tone="success">{text("account.signedIn")}</Badge>
      </Card>
      <p className="m-0 text-[13px] text-muted">{text("account.sessionsText")}</p>
      {done && <p className="m-0 rounded-xl border border-success/40 bg-success/10 px-3 py-2 text-[13px] font-semibold text-success">{done}</p>}
      <Button variant="secondary" icon="signout" loading={busy} className="self-end"
        onClick={async () => {
          setBusy(true);
          try { await api.logoutEverywhere(); await qc.invalidateQueries({ queryKey: ["me"] }); setDone(text("account.everywhereDone")); toast.success(text("account.everywhereDone")); }
          catch (e) { setDone(errorMessage(e)); }
          finally { setBusy(false); }
        }}>
        {text("account.everywhere")}
      </Button>
    </div>
  );
}

function DeleteAccount({ email }: { email: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const text = useText();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (confirm.trim().toLowerCase() !== email) return setError(text("account.errEmail"));
    if (!password) return setError(text("auth.noPassword"));
    setBusy(true);
    try {
      await api.deleteAccount(password, confirm.trim());
      qc.clear();
      router.replace("/login");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" aria-label={text("account.deleteTitle")}>
      <p className="m-0 flex gap-2 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2.5 text-[13px] text-danger"><Icon name="warn" size={17} className="mt-px shrink-0" />{text("account.deleteText")}</p>
      <Card className="flex flex-col gap-3">
        <Field label={text("account.typeEmail", { email })} error={confirm && confirm.trim().toLowerCase() !== email ? text("account.errEmail") : ""} ok={confirm.trim().toLowerCase() === email ? "✓" : ""}>
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
        </Field>
        <Field label={text("account.yourPassword")}><PasswordInput autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      </Card>
      {error && <ErrorBanner message={error} />}
      <Button type="submit" variant="danger" icon="trash" loading={busy} disabled={confirm.trim().toLowerCase() !== email || !password} className="self-end bg-danger text-white hover:bg-danger">{busy ? text("account.deleting") : text("account.deleteAll")}</Button>
    </form>
  );
}

type Panel = "password" | "sessions" | "payments" | "delete";

/** Payments & receipts: every order (paid ones with their receipt number; the receipt itself was emailed). */
function Payments() {
  const text = useText();
  const q = useSafeQuery({ queryKey: ["my-payments"], queryFn: api.payments });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBanner message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  const list = q.data ?? [];
  if (!list.length) return <p className="m-0 text-[13px] text-muted">{text("account.noPayments")}</p>;
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-[12.5px] text-muted">{text("account.paymentsNote")}</p>
      {list.map((p) => (
        <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-border bg-surface px-4 py-3">
          <div className="min-w-0 flex-1">
            <b className="block truncate text-[14px]">{p.label}</b>
            <span className="text-[12px] text-muted">{new Date(p.paidAt ?? p.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}{p.receiptNo ? ` · ${p.receiptNo}` : ""}</span>
          </div>
          <b className="tabular-nums">₹{p.amount.toLocaleString("en-IN")}</b>
          <Badge tone={p.status === "paid" ? "success" : "neutral"}>{p.status === "paid" ? text("account.paid") : text("account.notPaid")}</Badge>
        </div>
      ))}
    </div>
  );
}

/** My account: who you are and your plan at the top, your credits, then the account's settings as rows (a tap opens the
 * form on the right: password, devices, delete), the look, and Sign out. Every text is in Admin → CMS → My account. */
export default function AccountPage() {
  const me = useMe();
  const credits = useCredits();
  const qc = useQueryClient();
  const router = useRouter();
  const text = useText();
  const [panel, setPanel] = useState<Panel | null>(null);

  if (me.isLoading) return <Spinner label={text("account.loading")} />;
  if (!me.data?.authEnabled)
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
        <PageHeader title={text("nav.myAccount")} />
        <Card><p className="m-0 text-[12.5px] text-muted">{text("account.noAccounts")}</p></Card>
        <ThemeChoice />
      </div>
    );
  const user = me.data.user;
  if (!user) return <Spinner label={text("account.signingIn")} />;
  const c = credits.data?.enabled ? credits.data : null;
  const name = user.email.split("@")[0];
  const paid = !!c && c.plan !== "free";
  const signOut = async () => { await api.logout(); await qc.invalidateQueries(); router.replace("/login"); };

  const row = (id: Panel, icon: string, title: string, line: string, danger = false) => (
    <button type="button" onClick={() => setPanel(id)} aria-haspopup="dialog"
      className="flex w-full items-center gap-3 border-t border-border px-4 py-3.5 text-left transition-colors first:border-t-0 hover:bg-accent/6 md:px-5">
      <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", danger ? "bg-danger/12 text-danger" : "bg-accent/12 text-accent")}><Icon name={icon} size={18} /></span>
      <span className="min-w-0 flex-1">
        <b className={cn("block text-[14px]", danger && "text-danger")}>{title}</b>
        <span className="block truncate text-[12.5px] text-muted">{line}</span>
      </span>
      <Icon name="chevron" size={18} className="shrink-0 text-muted" />
    </button>
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <PageHeader title={text("nav.myAccount")} />

      {/* who you are, and your plan */}
      <Card className="relative flex flex-col gap-4 overflow-hidden sm:flex-row sm:items-center">
        <span aria-hidden className="pointer-events-none absolute -right-10 -top-16 h-44 w-44 rounded-full bg-[radial-gradient(closest-side,rgba(216,189,123,.2),transparent)]" />
        <div className="relative flex min-w-0 flex-1 items-center gap-4">
          <Avatar email={name} size={64} />
          <div className="min-w-0">
            <Heading className="truncate capitalize">{name}</Heading>
            <p className="m-0 flex min-w-0 items-center gap-1.5 text-[13px] text-muted"><span className="truncate">{user.email}</span>
              {user.emailVerified === false ? <Badge tone="warning" className="h-5 shrink-0 px-2 text-[11px]">{text("auth.unverifiedBadge")}</Badge>
                : <Badge tone="success" className="h-5 shrink-0 px-2 text-[11px]"><Icon name="check" size={11} />{text("auth.verifiedBadge")}</Badge>}</p>
            <Badge tone={paid ? "brand" : "neutral"} className="mt-1.5 h-6 px-2.5">{paid && <Icon name="crown" size={12} />}{c ? text("nav.planSuffix", { plan: c.planName }) : text("plan.free")}</Badge>
          </div>
        </div>
        <div className="relative flex flex-col gap-1.5 sm:items-end">
          <Button href="/pricing" icon={paid ? "coins" : "crown"} variant={paid ? "secondary" : "primary"}>{text(paid ? "account.manage" : "account.upgrade")}</Button>
          {!paid && <span className="max-w-[260px] text-[12px] text-muted sm:text-right">{text("account.freeLine")}</span>}
        </div>
      </Card>

      {/* your credits */}
      {c && (
        <Card className="grid divide-y divide-border p-0 md:grid-cols-3 md:divide-x md:divide-y-0 md:p-0">
          {([
            ["bolt", text("account.statCredits"), c.balance.toLocaleString("en-IN"), c.monthly ? text("account.monthly", { n: c.monthly.toLocaleString("en-IN") }) : ""],
            ["crown", text("account.statPlan"), c.planName, paid && c.planEnds ? text("account.until", { date: day(c.planEnds) }) : text("account.forever")],
            ["coins", text("account.statExtra"), c.extra.toLocaleString("en-IN"), text("account.neverExpire")],
          ] as const).map(([icon, label, value, note]) => (
            <div key={label} className="flex min-w-0 flex-col gap-1 px-3 py-3.5 sm:px-4">
              <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-muted"><Icon name={icon} size={13} className="hidden text-accent sm:block" /><span className="truncate">{label}</span></span>
              <b className="truncate font-[family-name:var(--font-display)] text-[20px] font-semibold leading-tight tracking-[-0.01em] sm:text-[22px]">{value}</b>
              {note && <span className="truncate text-[11px] text-muted">{note}</span>}
            </div>
          ))}
        </Card>
      )}

      <AdSlot place="account" />

      {/* the account's settings */}
      <section aria-label={text("account.security")} className="flex flex-col gap-2">
        <span className="px-1 text-[11px] font-bold uppercase tracking-[0.2em] text-muted">{text("account.security")}</span>
        <Card className="overflow-hidden p-0 md:p-0">
          {row("password", "key", text("account.changeTitle"), text("account.rowPassword"))}
          {row("sessions", "shield", text("account.devices"), text("account.rowSessions"))}
          {row("payments", "coins", text("account.paymentsTitle"), text("account.rowPayments"))}
        </Card>
      </section>

      <ThemeChoice />

      <section aria-label={text("account.danger")} className="flex flex-col gap-2">
        <span className="px-1 text-[11px] font-bold uppercase tracking-[0.2em] text-muted">{text("account.danger")}</span>
        <Card className="overflow-hidden border-danger/30 p-0 md:p-0">{row("delete", "trash", text("account.deleteTitle"), text("account.rowDelete"), true)}</Card>
      </section>

      <Button variant="secondary" icon="signout" onClick={() => void signOut()} className="self-center">{text("nav.signOut")}</Button>

      <SidePanel open={panel === "password"} onClose={() => setPanel(null)} title={text("account.changeTitle")} where={text("nav.myAccount")}>
        <ChangePassword email={user.email} onDone={() => setPanel(null)} />
      </SidePanel>
      <SidePanel open={panel === "sessions"} onClose={() => setPanel(null)} title={text("account.devices")} where={text("nav.myAccount")}><Sessions /></SidePanel>
      <SidePanel open={panel === "payments"} onClose={() => setPanel(null)} title={text("account.paymentsTitle")} where={text("nav.myAccount")}><Payments /></SidePanel>
      <SidePanel open={panel === "delete"} onClose={() => setPanel(null)} title={text("account.deleteTitle")} where={text("nav.myAccount")}><DeleteAccount email={user.email} /></SidePanel>
    </div>
  );
}
