"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon, Spinner } from "@/components/atoms";
import { ErrorBanner } from "@/components/molecules";
import { confirmAction } from "@/components/molecules/ConfirmDialog";
import { api, errorMessage } from "@/lib/api";
import type { AdminUserDetail } from "@/types/api";
import { ago, count, date, dateTime, page, rupees } from "./format";
import { LiveDot } from "./OverviewTab";
import { AdminPlan, PlanPicker } from "./UsersTab";
import { cn } from "@/lib/cn";

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-muted text-[11px]">{label}</span>
      <span className="text-[12.5px] truncate font-bold">{value}</span>
    </div>
  );
}

/** Delete the account, at the bottom of the panel: the email typed to confirm, then asked once more. */
function DeleteUser({ user, onDone }: { user: AdminUserDetail; onDone: () => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false), [typed, setTyped] = useState("");
  const del = useMutation({ meta: { success: "User deleted", errorShown: true },
    mutationFn: () => api.adminDeleteUser(user.id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["admin"] }); onDone(); },
  });
  const match = typed.trim().toLowerCase() === user.email.toLowerCase();
  const go = async () => {
    if (!match) return;
    if (await confirmAction({ title: `Delete ${user.email}?`, body: "Their account, Reels, drafts, credits and affiliate account are deleted for good. Payments stay in your records, without their name. This cannot be undone.", ok: "Delete for good", danger: true })) del.mutate();
  };
  return (
    <section className="flex min-w-0 flex-col gap-2.5 rounded-2xl border border-danger/40 bg-surface p-3.5" aria-label="Delete account">
      <span className="m-0 text-[15px] font-bold text-danger">Delete account</span>
      {!open ? (
        <>
          <span className="text-[12.5px] text-muted">Deletes the account and everything in it. It cannot be undone.</span>
          <button type="button" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-danger/40 bg-surface px-4 text-sm font-bold text-danger hover:border-danger" onClick={() => setOpen(true)}>
            <Icon name="trash" size={16} />Delete this account
          </button>
        </>
      ) : (
        <>
          <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-muted">
            Type <b className="text-foreground">{user.email}</b> to confirm
            <input className="h-11 w-full min-w-0 rounded-xl border border-border bg-surface px-3 text-[14px] font-medium text-foreground outline-none focus:border-danger" autoComplete="off" spellCheck={false}
              value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={user.email} />
          </label>
          {del.error && <ErrorBanner message={errorMessage(del.error)} />}
          <div className="grid grid-cols-2 gap-2.5">
            <button type="button" className="h-11 rounded-xl border border-border bg-surface px-4 text-sm font-bold text-muted hover:text-foreground" onClick={() => { setOpen(false); setTyped(""); del.reset(); }}>Cancel</button>
            <button type="button" disabled={!match || del.isPending} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-danger px-4 text-sm font-bold text-white disabled:opacity-50" onClick={() => void go()}>
              {del.isPending ? "Deleting…" : "Delete for good"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function GiveCredits({ user }: { user: AdminUserDetail }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const give = useMutation({ meta: { success: "Credits given", errorShown: true },
    mutationFn: (n: number) => api.adminGiveCredits(user.id, n, note.trim()),
    onSuccess: (d) => {
      qc.setQueryData(["admin", "user", user.id], d);
      void qc.invalidateQueries({ queryKey: ["admin", "users"] });
      void qc.invalidateQueries({ queryKey: ["admin", "overview"] });
      setAmount("");
      setNote("");
    },
  });
  async function submit(sign: 1 | -1) {
    const n = Math.trunc(Number(amount));
    if (!n || n < 0) return;
    const ok = await confirmAction({
      title: sign > 0 ? `Give ${n} credits?` : `Take back ${n} credits?`,
      body: `${user.email} ${sign > 0 ? "gets" : "loses"} ${n} credit${n === 1 ? "" : "s"}. It shows in their credit history.`,
      ok: sign > 0 ? "Give credits" : "Take back",
      danger: sign < 0,
    });
    if (ok) give.mutate(sign * n);
  }
  return (
    <section className="flex min-w-0 flex-col gap-2.5 rounded-2xl border border-border bg-surface p-3.5 shadow-[var(--shadow)]" aria-label="Give credits">
      <span className="m-0 text-[15px] font-bold">Give or take back credits</span>
      <div className="flex gap-2">
        <input className="min-w-0 rounded-xl border border-border bg-surface px-3 text-[14px] font-medium text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_22%,transparent)] disabled:opacity-60 h-11 w-28" type="number" min={1} inputMode="numeric" placeholder="Credits" aria-label="Credits" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <input className="w-full min-w-0 rounded-xl border border-border bg-surface px-3 text-[14px] font-medium text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_22%,transparent)] disabled:opacity-60 h-11 flex-1" placeholder="Note (optional)" aria-label="Note" maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {give.error && <ErrorBanner message={errorMessage(give.error)} />}
      <div className="grid grid-cols-2 gap-2.5">
        <button type="button" className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-bold transition-[filter,border-color,background-color,color] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent border border-transparent bg-gold text-on-accent shadow-[0_12px_26px_-14px_var(--brand-glow)] hover:brightness-110 h-11 rounded-xl px-4 text-sm" disabled={give.isPending || !(Number(amount) > 0)} onClick={() => void submit(1)}>
          Give
        </button>
        <button type="button" className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-bold transition-[filter,border-color,background-color,color] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent border border-danger/40 bg-surface text-danger hover:border-danger h-11 rounded-xl px-4 text-sm" disabled={give.isPending || !(Number(amount) > 0)} onClick={() => void submit(-1)}>
          Take back
        </button>
      </div>
    </section>
  );
}

/** One person in full, as a panel over the dashboard. */
export function UserPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ["admin", "user", id], queryFn: () => api.adminUser(id), refetchInterval: 60_000 });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const u = q.data, online = u?.devices.some((d) => d.online);
  return (
    // a popup in the middle of the screen (phones too), over a dimmed page; a tap outside or Esc closes it
    <div className="fixed inset-0 z-[60] grid place-items-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-[var(--overlay)] backdrop-blur-[2px]" onClick={onClose} />
      <aside role="dialog" aria-modal="true" aria-label="User details"
        className="relative flex max-h-[calc(100dvh-24px)] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl sm:max-h-[min(860px,calc(100dvh-48px))]">
        <div className="flex items-center justify-between gap-2.5 border-b border-border px-4 py-3">
          <span className="flex items-center min-w-0 gap-2">
            {online && <LiveDot />}
            <span className="m-0 text-[15px] font-bold truncate">{u?.email ?? "User"}</span>
            {u?.admin && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--chip-on)] px-2 py-0.5 text-[11px] font-bold text-accent"><Icon name="shield" size={11} />Admin</span>}
          </span>
          <button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-border p-0 text-foreground transition-colors hover:text-accent border-0 bg-transparent" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {q.isLoading && <Spinner />}
          {q.error && <ErrorBanner message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
          {u && (
            <>
              <section className="flex min-w-0 flex-col gap-2.5 rounded-2xl border border-border bg-surface p-3.5 shadow-[var(--shadow)]">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Fact label="Joined" value={date(u.createdAt)} />
                  <Fact label="Last login" value={ago(u.lastLoginAt)} />
                  <Fact label="Last seen" value={online ? "online now" : ago(u.lastSeenAt)} />
                  <Fact label="Logins" value={count(u.logins)} />
                  <Fact label="Spent" value={rupees(u.payments.filter((p) => p.status === "paid").reduce((s, p) => s + p.rupees, 0))} />
                  <Fact label="Reels" value={count(u.reels.length)} />
                </div>
              </section>

              {u.wallet ? (
                <section className="flex min-w-0 flex-col gap-2.5 rounded-2xl border border-border bg-surface p-3.5 shadow-[var(--shadow)]" aria-label="Credits">
                  <div className="flex items-center justify-between gap-2.5">
                    <span className="m-0 text-[15px] font-bold">Credits</span>
                    <span className="inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[11px] font-bold bg-[var(--chip-on)] text-accent">
                      {u.admin ? "Admin · all open" : `${u.wallet.planName} plan${u.wallet.period ? ` · ${u.wallet.period}` : ""}`}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 sm:gap-3">
                    <Fact label="Left" value={count(u.wallet.balance)} />
                    <Fact label="This month's" value={count(u.wallet.monthly)} />
                    <Fact label="Top-ups" value={count(u.wallet.extra)} />
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-border pt-2.5">
                    <span className="text-[12.5px] text-muted">Plan</span>
                    {u.admin ? <AdminPlan /> : <PlanPicker user={{ id: u.id, email: u.email, plan: u.wallet.plan, planName: u.wallet.planName }} />}
                  </div>
                  {u.wallet.planEnds && <span className="text-muted text-[11px]">Plan ends {date(u.wallet.planEnds)}{u.wallet.renews ? ` · credits renew ${date(u.wallet.renews)}` : ""}</span>}
                </section>
              ) : (
                <span className="text-muted text-[12.5px]">Billing is off: this studio does not count credits.</span>
              )}
              {u.wallet && <GiveCredits user={u} />}

              <section className="flex min-w-0 flex-col gap-2.5 rounded-2xl border border-border bg-surface p-3.5 shadow-[var(--shadow)]" aria-label="Purchases">
                <span className="m-0 text-[15px] font-bold">Purchases</span>
                {u.payments.length ? (
                  <ul className="flex flex-col">
                    {u.payments.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2.5 border-t border-border py-2 first:border-t-0">
                        <span className="flex min-w-0 flex-col">
                          <span className="text-[12.5px] truncate">{p.label}</span>
                          <span className="text-muted text-[11px]">{dateTime(p.paidAt ?? p.createdAt)}</span>
                        </span>
                        <span className="flex items-center shrink-0 gap-2">
                          <span className={cn("inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full bg-surface-2 px-2 text-[11px] font-bold text-muted", p.status === "paid" && "bg-success/15 text-success")}>{p.status === "created" ? "not paid" : p.status}</span>
                          <b className="text-[12.5px]">{rupees(p.rupees)}</b>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-muted text-[12.5px]">No purchases yet.</span>
                )}
              </section>

              <section className="flex min-w-0 flex-col gap-2.5 rounded-2xl border border-border bg-surface p-3.5 shadow-[var(--shadow)]" aria-label="Credit history">
                <span className="m-0 text-[15px] font-bold">Credit history</span>
                {u.history.length ? (
                  <ul className="flex flex-col">
                    {u.history.map((e, i) => (
                      <li key={i} className="flex items-center justify-between gap-2.5 border-t border-border py-2 first:border-t-0">
                        <span className="flex min-w-0 flex-col">
                          <span className="text-[12.5px] truncate">
                            {e.reason}
                            {e.refunded && <span className="text-muted"> · refunded</span>}
                          </span>
                          <span className="text-muted text-[11px]">{dateTime(e.at)}</span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end">
                          <b className={`text-[12.5px] ${e.delta > 0 ? "text-success" : ""}`}>{e.delta > 0 ? `+${e.delta}` : e.delta}</b>
                          {e.balance !== null && <span className="text-muted text-[11px]">left {e.balance}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-muted text-[12.5px]">No credit changes yet.</span>
                )}
              </section>

              <section className="flex min-w-0 flex-col gap-2.5 rounded-2xl border border-border bg-surface p-3.5 shadow-[var(--shadow)]" aria-label="Recent Reels">
                <span className="m-0 text-[15px] font-bold">Recent Reels</span>
                {u.reels.length ? (
                  <ul className="flex flex-col">
                    {u.reels.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-2.5 border-t border-border py-2 first:border-t-0">
                        <span className="text-[12.5px] truncate">{r.name}</span>
                        <span className="flex items-center shrink-0 gap-2">
                          <span className="inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full bg-surface-2 px-2 text-[11px] font-bold text-muted">{r.status || "draft"}</span>
                          <span className="text-muted text-[11px]">{date(r.createdAt)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-muted text-[12.5px]">No Reels yet.</span>
                )}
              </section>

              {u.devices.length > 0 && (
                <section className="flex min-w-0 flex-col gap-2.5 rounded-2xl border border-border bg-surface p-3.5 shadow-[var(--shadow)]" aria-label="Devices">
                  <span className="m-0 text-[15px] font-bold">Devices</span>
                  <ul className="flex flex-col">
                    {u.devices.map((d, i) => (
                      <li key={i} className="flex items-center justify-between gap-2.5 border-t border-border py-2 first:border-t-0">
                        <span className="text-[12.5px]">
                          {d.device} · <span className="text-muted">{page(d.path)}</span>
                        </span>
                        <span className={`text-[11px] ${d.online ? "text-success" : "text-muted"}`}>{d.online ? "online" : ago(d.at)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {u.admin || u.self ? (
                <section className="flex min-w-0 items-start gap-2.5 rounded-2xl border border-border bg-surface p-3.5" aria-label="Delete account">
                  <Icon name="shield" size={16} className="mt-0.5 shrink-0 text-accent" />
                  <span className="text-[12.5px] text-muted">{u.admin ? "This is an administrator account, so it cannot be deleted. Remove it from the administrators (Admin → Settings → Administrators, or ADMIN_EMAILS on the server) first." : "This is your own account: it cannot be deleted from here."}</span>
                </section>
              ) : <DeleteUser user={u} onDone={onClose} />}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
