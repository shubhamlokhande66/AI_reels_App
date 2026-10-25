"use client";

import { useQuery } from "@tanstack/react-query";
import { Avatar, Badge, Heading, Icon, Spinner } from "@/components/atoms";
import { EmptyState, ErrorBanner, SectionCard } from "@/components/molecules";
import { StatTile } from "@/components/molecules/StatTile";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { AdminOverview } from "@/types/api";
import { BarChart } from "./BarChart";
import { ago, count, page, rupees } from "./format";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const useOverview = () => useQuery({ queryKey: ["admin", "overview"], queryFn: api.adminOverview, refetchInterval: 60_000 });

export function LiveDot() {
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-70" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success" />
    </span>
  );
}

/** "Good morning" by the clock here */
const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };

/** where the dashboard can take you: a tab of the admin, or the CMS (its own tab of the browser) */
export type QuickTab = "users" | "templates" | "settings" | "ai";
const QUICK: { icon: string; label: string; tab?: QuickTab; href?: string }[] = [
  { icon: "text", label: "Open CMS", href: "/cms" }, { icon: "user", label: "Users", tab: "users" }, { icon: "grid", label: "Templates", tab: "templates" },
  { icon: "gear", label: "Settings", tab: "settings" }, { icon: "wand", label: "AI settings", tab: "ai" },
];

function LiveVisitors({ o }: { o: AdminOverview }) {
  return (
    <SectionCard icon="eye" title="Live visitors" sub={`${o.visitors.onlineSignedIn} signed in · ${o.visitors.onlineGuests} guest${o.visitors.onlineGuests === 1 ? "" : "s"} · updates every minute`}
      aside={<Badge tone="success" className="h-6"><LiveDot />{o.visitors.online} now</Badge>}>
      {o.online.length ? (
        <ul className="m-0 flex max-h-80 list-none flex-col overflow-y-auto p-0">
          {o.online.map((v) => (
            <li key={v.id} className="flex items-center gap-3 border-t border-border py-2.5 first:border-t-0">
              {v.email ? <Avatar email={v.email} size={32} /> : <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2 text-muted"><Icon name="user" size={15} /></span>}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cn("truncate text-[13px] font-bold", !v.email && "text-muted")}>{v.email ?? "Guest"}</span>
                <span className="truncate text-[11.5px] text-muted">{page(v.path)} · {v.device}</span>
              </span>
              <span className="shrink-0 text-[11.5px] text-muted">{ago(v.since).replace(" ago", "")}</span>
            </li>
          ))}
        </ul>
      ) : <p className="m-0 rounded-xl bg-surface-2/50 py-6 text-center text-[12.5px] text-muted">Nobody else is on the site right now.</p>}
    </SectionCard>
  );
}

export function OverviewTab({ onOpenUser, onOpenTab }: { onOpenUser: (id: string) => void; onOpenTab?: (t: QuickTab) => void }) {
  const q = useOverview();
  if (q.isLoading) return <Spinner label="Loading the dashboard…" />;
  if (q.error || !q.data) return <ErrorBanner message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const o = q.data;
  const signups = o.signupsByDay.map((d) => ({ key: d.day, short: String(Number(d.day.slice(8))), value: d.users }));
  const revenue = o.revenueByMonth.map((m) => ({ key: m.month, short: MONTHS[Number(m.month.slice(5)) - 1], value: m.rupees }));
  const planTotal = Math.max(1, o.plans.reduce((s, p) => s + p.users, 0));
  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="flex flex-col gap-4">
      {/* hello, and where to go */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[12.5px] text-muted">{today}</p>
          <Heading size="page" className="text-[26px] md:text-[28px]">{greeting()} 👋</Heading>
        </div>
        <div className="flex flex-wrap gap-2">
          {QUICK.map((x) => x.href ? (
            <a key={x.label} href={x.href} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-accent/50 bg-accent/10 px-3 text-[12.5px] font-bold text-accent hover:bg-accent/15">
              <Icon name={x.icon} size={15} />{x.label} ↗
            </a>
          ) : (
            <button key={x.label} type="button" onClick={() => x.tab && onOpenTab?.(x.tab)} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-surface px-3 text-[12.5px] font-bold hover:border-accent/60">
              <Icon name={x.icon} size={15} className="text-accent" />{x.label}
            </button>
          ))}
        </div>
      </div>

      {/* the numbers */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon="eye" label="Online now" value={count(o.visitors.online)} lead={<LiveDot />} note={`${o.visitors.today} visitors today · ${o.visitors.week} this week`} />
        <StatTile icon="user" label="Users" value={count(o.users.total)} note={`+${o.users.today} today · +${o.users.week} this week`} />
        <StatTile icon="coins" label="Revenue" value={rupees(o.revenue.total)} note={`${rupees(o.revenue.month)} in 30 days · ${o.revenue.payments} payments`} />
        <StatTile icon="bolt" label="Credits left" value={o.billing ? count(o.credits.left) : "—"} note={o.billing ? `${count(o.credits.used30d)} used in 30 days` : "Billing is off"} />
      </div>

      {/* growth */}
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard icon="trend" title="Sign-ups" sub="New accounts per day, last 14 days" className="lg:col-span-2"
          aside={<Badge tone="brand">+{o.users.week} this week</Badge>}>
          <BarChart label="New accounts per day, last 14 days" data={signups} format={count} />
        </SectionCard>
        <SectionCard icon="crown" title="Plans & customers" sub={`${count(o.users.buyers)} have paid · ${count(o.reels.total)} Reels in My Reels`}>
          {o.plans.length ? (
            <div className="flex flex-col gap-3">
              {o.plans.map((p) => {
                const share = Math.round((p.users / planTotal) * 100);
                return (
                  <div key={p.plan} className="flex flex-col gap-1.5">
                    <span className="flex items-center justify-between gap-2 text-[13px]">
                      <span className="flex items-center gap-1.5 font-semibold">{p.plan !== "free" && <Icon name="crown" size={13} color="#f5c84c" />}{p.name}</span>
                      <span className="text-muted"><b className="text-foreground">{count(p.users)}</b> · {share}%</span>
                    </span>
                    <span className="block h-2 overflow-hidden rounded-full bg-surface-2"><i className="block h-full rounded-full [background:var(--gold-gradient)]" style={{ width: `${Math.max(share, p.users ? 3 : 0)}%` }} /></span>
                  </div>
                );
              })}
            </div>
          ) : <p className="m-0 text-[12.5px] text-muted">No wallets yet{o.billing ? "" : " (billing is off)"}.</p>}
        </SectionCard>
      </div>

      <SectionCard icon="coins" title="Revenue" sub="Paid revenue per month, last 12 months" aside={<Badge tone="success">{rupees(o.revenue.month)} in 30 days</Badge>}>
        <BarChart label="Paid revenue per month, last 12 months" data={revenue} format={rupees} />
      </SectionCard>

      {/* what is happening */}
      <div className="grid gap-4 lg:grid-cols-3">
        <LiveVisitors o={o} />
        <SectionCard icon="user" title="Newest users" sub="Tap one to see everything about them" aside={onOpenTab && <button type="button" onClick={() => onOpenTab("users")} className="text-[12px] font-bold text-accent">All users</button>}>
          {o.recentUsers.length ? (
            <ul className="m-0 flex list-none flex-col p-0">
              {o.recentUsers.map((u) => (
                <li key={u.id}>
                  <button type="button" onClick={() => onOpenUser(u.id)} className="flex w-full items-center gap-3 border-t border-border py-2.5 text-left hover:text-accent">
                    <Avatar email={u.email} size={32} />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{u.email}</span>
                    <span className="shrink-0 text-[11.5px] text-muted">{ago(u.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <EmptyState icon="user" title="No accounts yet" hint="New sign-ups show up here." />}
        </SectionCard>
        <SectionCard icon="coins" title="Latest payments" sub={`${o.revenue.payments} payments in all`}>
          {o.recentPayments.length ? (
            <ul className="m-0 flex list-none flex-col p-0">
              {o.recentPayments.map((p) => (
                <li key={p.id} className="flex items-center gap-3 border-t border-border py-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-success/15 text-success"><Icon name="check" size={15} /></span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13px] font-semibold">{p.email}</span>
                    <span className="truncate text-[11.5px] text-muted">{p.label} · {ago(p.paidAt)}</span>
                  </span>
                  <b className="shrink-0 text-[13px] text-success">{rupees(p.rupees)}</b>
                </li>
              ))}
            </ul>
          ) : <EmptyState icon="coins" title="No payments yet" hint="Payments show up here as soon as they are made." />}
        </SectionCard>
      </div>
    </div>
  );
}
