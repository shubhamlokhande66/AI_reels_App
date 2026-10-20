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

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="mu xs">{label}</span>
      <span className="sm truncate font-bold">{value}</span>
    </div>
  );
}

function GiveCredits({ user }: { user: AdminUserDetail }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const give = useMutation({
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
    <section className="card" aria-label="Give credits">
      <span className="h2">Give or take back credits</span>
      <div className="flex gap-2">
        <input className="inp w-28" type="number" min={1} inputMode="numeric" placeholder="Credits" aria-label="Credits" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <input className="inp flex-1" placeholder="Note (optional)" aria-label="Note" maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {give.error && <ErrorBanner message={errorMessage(give.error)} />}
      <div className="g2">
        <button type="button" className="btn g" disabled={give.isPending || !(Number(amount) > 0)} onClick={() => void submit(1)}>
          Give
        </button>
        <button type="button" className="btn danger" disabled={give.isPending || !(Number(amount) > 0)} onClick={() => void submit(-1)}>
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
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-[var(--overlay)]" onClick={onClose} />
      <aside role="dialog" aria-modal="true" aria-label="User details" className="absolute inset-y-0 right-0 flex w-full max-w-[520px] flex-col bg-background shadow-2xl">
        <div className="between border-b border-border px-4 py-3">
          <span className="row min-w-0 gap-2">
            {online && <LiveDot />}
            <span className="h2 truncate">{u?.email ?? "User"}</span>
          </span>
          <button type="button" className="ib plain" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {q.isLoading && <Spinner />}
          {q.error && <ErrorBanner message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
          {u && (
            <>
              <section className="card">
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
                <section className="card" aria-label="Credits">
                  <div className="between">
                    <span className="h2">Credits</span>
                    <span className="badge b-run">
                      {u.wallet.planName} plan{u.wallet.period ? ` · ${u.wallet.period}` : ""}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <Fact label="Left" value={count(u.wallet.balance)} />
                    <Fact label="This month's" value={count(u.wallet.monthly)} />
                    <Fact label="Top-ups" value={count(u.wallet.extra)} />
                  </div>
                  {u.wallet.planEnds && <span className="mu xs">Plan ends {date(u.wallet.planEnds)}{u.wallet.renews ? ` · credits renew ${date(u.wallet.renews)}` : ""}</span>}
                </section>
              ) : (
                <span className="mu sm">Billing is off: this studio does not count credits.</span>
              )}
              {u.wallet && <GiveCredits user={u} />}

              <section className="card" aria-label="Purchases">
                <span className="h2">Purchases</span>
                {u.payments.length ? (
                  <ul className="flex flex-col">
                    {u.payments.map((p) => (
                      <li key={p.id} className="between border-t border-border py-2 first:border-t-0">
                        <span className="flex min-w-0 flex-col">
                          <span className="sm truncate">{p.label}</span>
                          <span className="mu xs">{dateTime(p.paidAt ?? p.createdAt)}</span>
                        </span>
                        <span className="row shrink-0 gap-2">
                          <span className={`badge ${p.status === "paid" ? "b-ok" : ""}`}>{p.status === "created" ? "not paid" : p.status}</span>
                          <b className="sm">{rupees(p.rupees)}</b>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="mu sm">No purchases yet.</span>
                )}
              </section>

              <section className="card" aria-label="Credit history">
                <span className="h2">Credit history</span>
                {u.history.length ? (
                  <ul className="flex flex-col">
                    {u.history.map((e, i) => (
                      <li key={i} className="between border-t border-border py-2 first:border-t-0">
                        <span className="flex min-w-0 flex-col">
                          <span className="sm truncate">
                            {e.reason}
                            {e.refunded && <span className="mu"> · refunded</span>}
                          </span>
                          <span className="mu xs">{dateTime(e.at)}</span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end">
                          <b className={`sm ${e.delta > 0 ? "text-success" : ""}`}>{e.delta > 0 ? `+${e.delta}` : e.delta}</b>
                          {e.balance !== null && <span className="mu xs">left {e.balance}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="mu sm">No credit changes yet.</span>
                )}
              </section>

              <section className="card" aria-label="Recent Reels">
                <span className="h2">Recent Reels</span>
                {u.reels.length ? (
                  <ul className="flex flex-col">
                    {u.reels.map((r) => (
                      <li key={r.id} className="between border-t border-border py-2 first:border-t-0">
                        <span className="sm truncate">{r.name}</span>
                        <span className="row shrink-0 gap-2">
                          <span className="badge">{r.status || "draft"}</span>
                          <span className="mu xs">{date(r.createdAt)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="mu sm">No Reels yet.</span>
                )}
              </section>

              {u.devices.length > 0 && (
                <section className="card" aria-label="Devices">
                  <span className="h2">Devices</span>
                  <ul className="flex flex-col">
                    {u.devices.map((d, i) => (
                      <li key={i} className="between border-t border-border py-2 first:border-t-0">
                        <span className="sm">
                          {d.device} · <span className="mu">{page(d.path)}</span>
                        </span>
                        <span className={`xs ${d.online ? "text-success" : "mu"}`}>{d.online ? "online" : ago(d.at)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
