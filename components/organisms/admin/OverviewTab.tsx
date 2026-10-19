"use client";

import { useQuery } from "@tanstack/react-query";
import { Icon, Spinner } from "@/components/atoms";
import { ErrorBanner } from "@/components/molecules";
import { api, errorMessage } from "@/lib/api";
import type { AdminOverview } from "@/types/api";
import { BarChart } from "./BarChart";
import { ago, count, page, rupees } from "./format";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const useOverview = () => useQuery({ queryKey: ["admin", "overview"], queryFn: api.adminOverview, refetchInterval: 15_000 });

function Stat({ label, value, note, icon, live }: { label: string; value: string; note?: string; icon: string; live?: boolean }) {
  return (
    <div className="stat">
      <span className="mu xs font-bold">{label}</span>
      <span className="ic" style={{ color: "var(--accent)", background: "var(--chip-on)" }}>
        <Icon name={icon} size={18} />
      </span>
      <span className="row gap-2">
        {live && <LiveDot />}
        <b>{value}</b>
      </span>
      {note && <span className="mu xs col-span-2">{note}</span>}
    </div>
  );
}

export function LiveDot() {
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-70" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success" />
    </span>
  );
}

function LiveVisitors({ o }: { o: AdminOverview }) {
  return (
    <section className="card" aria-label="Live visitors">
      <div className="between">
        <span className="row gap-2">
          <LiveDot />
          <span className="h2">Live visitors</span>
        </span>
        <span className="mu xs">updates every 15 s</span>
      </div>
      <span className="mu sm">
        {o.visitors.online} on the site now · {o.visitors.onlineSignedIn} signed in · {o.visitors.onlineGuests} guest{o.visitors.onlineGuests === 1 ? "" : "s"}
      </span>
      {o.online.length ? (
        <ul className="flex max-h-72 flex-col overflow-y-auto">
          {o.online.map((v) => (
            <li key={v.id} className="between border-t border-border py-2 first:border-t-0">
              <span className="row min-w-0 gap-2.5">
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${v.email ? "bg-[var(--chip-on)] text-accent" : "bg-surface-2 text-muted"}`}>
                  <Icon name="user" size={15} />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className={`sm truncate font-bold ${v.email ? "" : "mu"}`}>{v.email ?? "Guest"}</span>
                  <span className="mu xs truncate">
                    {page(v.path)} · {v.device}
                  </span>
                </span>
              </span>
              <span className="mu xs shrink-0">here since {ago(v.since).replace(" ago", "")}</span>
            </li>
          ))}
        </ul>
      ) : (
        <span className="mu sm">Nobody else is on the site right now.</span>
      )}
    </section>
  );
}

export function OverviewTab({ onOpenUser }: { onOpenUser: (id: string) => void }) {
  const q = useOverview();
  if (q.isLoading) return <Spinner label="Loading the dashboard…" />;
  if (q.error || !q.data) return <ErrorBanner message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const o = q.data;
  const signups = o.signupsByDay.map((d) => ({ key: d.day, short: String(Number(d.day.slice(8))), value: d.users }));
  const revenue = o.revenueByMonth.map((m) => ({ key: m.month, short: MONTHS[Number(m.month.slice(5)) - 1], value: m.rupees }));
  const planMax = Math.max(1, ...o.plans.map((p) => p.users));
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Online now" value={count(o.visitors.online)} note={`${o.visitors.today} visitors today · ${o.visitors.week} this week`} icon="eye" live />
        <Stat label="Users" value={count(o.users.total)} note={`+${o.users.today} today · +${o.users.week} this week`} icon="user" />
        <Stat label="Revenue" value={rupees(o.revenue.total)} note={`${rupees(o.revenue.month)} in 30 days · ${o.revenue.payments} payments`} icon="coins" />
        <Stat label="Credits left" value={o.billing ? count(o.credits.left) : "—"} note={o.billing ? `${count(o.credits.used30d)} used in 30 days` : "Billing is off"} icon="bolt" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <LiveVisitors o={o} />
        </div>
        <section className="card" aria-label="Customers">
          <span className="h2">Customers</span>
          <div className="g2">
            <div className="stat" style={{ gridTemplateColumns: "1fr" }}>
              <b>{count(o.users.buyers)}</b>
              <span className="mu xs">have paid</span>
            </div>
            <div className="stat" style={{ gridTemplateColumns: "1fr" }}>
              <b>{count(o.reels.total)}</b>
              <span className="mu xs">Reels in My Reels</span>
            </div>
          </div>
          <span className="eb pt-1">Plans</span>
          {o.plans.length ? (
            o.plans.map((p) => (
              <div key={p.plan} className="flex flex-col gap-1">
                <span className="between sm">
                  <span>{p.name}</span>
                  <b>{count(p.users)}</b>
                </span>
                <span className="bar">
                  <i style={{ width: `${(p.users / planMax) * 100}%` }} />
                </span>
              </div>
            ))
          ) : (
            <span className="mu sm">No wallets yet{o.billing ? "" : " (billing is off)"}.</span>
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card" aria-label="Sign-ups">
          <span className="h2">Sign-ups · last 14 days</span>
          <BarChart label="New accounts per day, last 14 days" data={signups} format={count} />
        </section>
        <section className="card" aria-label="Revenue">
          <span className="h2">Revenue · last 12 months</span>
          <BarChart label="Paid revenue per month, last 12 months" data={revenue} format={rupees} />
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card" aria-label="Newest users">
          <span className="h2">Newest users</span>
          {o.recentUsers.length ? (
            <ul className="flex flex-col">
              {o.recentUsers.map((u) => (
                <li key={u.id}>
                  <button type="button" onClick={() => onOpenUser(u.id)} className="between w-full border-t border-border py-2 text-left hover:text-accent">
                    <span className="sm truncate">{u.email}</span>
                    <span className="mu xs shrink-0">{ago(u.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <span className="mu sm">No accounts yet.</span>
          )}
        </section>
        <section className="card" aria-label="Latest payments">
          <span className="h2">Latest payments</span>
          {o.recentPayments.length ? (
            <ul className="flex flex-col">
              {o.recentPayments.map((p) => (
                <li key={p.id} className="between border-t border-border py-2">
                  <span className="flex min-w-0 flex-col">
                    <span className="sm truncate">{p.email}</span>
                    <span className="mu xs truncate">
                      {p.label} · {ago(p.paidAt)}
                    </span>
                  </span>
                  <b className="sm shrink-0">{rupees(p.rupees)}</b>
                </li>
              ))}
            </ul>
          ) : (
            <span className="mu sm">No payments yet.</span>
          )}
        </section>
      </div>
    </div>
  );
}
