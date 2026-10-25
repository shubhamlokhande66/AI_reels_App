"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Avatar, Badge, Button, Card, Chip, ChipRow, Icon, Spinner } from "@/components/atoms";
import { EmptyState, ErrorBanner, SearchBox } from "@/components/molecules";
import { confirmAction } from "@/components/molecules/ConfirmDialog";
import { StatTile } from "@/components/molecules/StatTile";
import { api, errorMessage } from "@/lib/api";
import type { AdminUserRow } from "@/types/api";
import { ago, count, date, rupees } from "./format";
import { LiveDot } from "./OverviewTab";

/** Admin → Users: everyone who signed up. Numbers at the top, then search, filters and sort; on a computer a table
 * (who, activity, plan, credits, spent, Reels), on a phone a card per person. A row opens the person's panel; the
 * plan can be changed right here (asked first). */

type Filter = "all" | "online" | "paying" | "free";
type SortKey = "createdAt" | "lastSeenAt" | "email" | "credits" | "creditsUsed" | "spent" | "reels" | "logins";
const SORTS: { key: SortKey; label: string; desc: boolean }[] = [
  { key: "createdAt", label: "Newest first", desc: true }, { key: "lastSeenAt", label: "Last seen", desc: true }, { key: "email", label: "Email A–Z", desc: false },
  { key: "spent", label: "Spent most", desc: true }, { key: "credits", label: "Most credits left", desc: true }, { key: "creditsUsed", label: "Most credits used", desc: true },
  { key: "reels", label: "Most Reels", desc: true }, { key: "logins", label: "Most logins", desc: true },
];

export const useAdminUsers = () => useQuery({ queryKey: ["admin", "users"], queryFn: api.adminUsers, refetchInterval: 60_000 });

const sortValue = (u: AdminUserRow, k: SortKey): string | number => {
  const v = u[k];
  if (k === "email") return String(v).toLowerCase();
  if (typeof v === "number") return v;
  return v ? new Date(String(v)).getTime() : 0;
};

function csv(rows: AdminUserRow[]) {
  const head = ["Email", "Joined", "Last login", "Last seen", "Logins", "Plan", "Credits left", "Credits used", "Spent (INR)", "Purchases", "Reels"];
  const cell = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map((u) => [u.email, u.createdAt, u.lastLoginAt, u.lastSeenAt, u.logins, u.planName, u.credits ?? "", u.creditsUsed, u.spent, u.purchases, u.reels].map(cell).join(","));
  const url = URL.createObjectURL(new Blob([[head.map(cell).join(","), ...lines].join("\n")], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `users-${new Date().toISOString().slice(0, 10)}.csv` });
  a.click();
  URL.revokeObjectURL(url);
}

/** online now, else when last seen */
const Seen = ({ u }: { u: AdminUserRow }) => (u.online ? <span className="inline-flex items-center gap-1.5 font-semibold text-success"><LiveDot />Online now</span> : <span>{u.lastSeenAt ? `Seen ${ago(u.lastSeenAt)}` : "Never seen"}</span>);

export function UsersTab({ onOpenUser }: { onOpenUser: (id: string) => void }) {
  const q = useAdminUsers();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const sort = SORTS.find((s) => s.key === sortKey)!;
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? [])
      .filter((u) => !s || u.email.toLowerCase().includes(s))
      .filter((u) => filter === "all" || (filter === "online" ? u.online : filter === "paying" ? u.spent > 0 : u.spent === 0))
      .sort((a, b) => {
        const x = sortValue(a, sort.key), y = sortValue(b, sort.key);
        return (x < y ? -1 : x > y ? 1 : 0) * (sort.desc ? -1 : 1);
      });
  }, [q.data, search, filter, sort]);

  if (q.isLoading) return <Spinner label="Loading users…" />;
  if (q.error || !q.data) return <ErrorBanner message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const all = q.data;
  const online = all.filter((u) => u.online).length, paying = all.filter((u) => u.spent > 0).length;
  const filters: { id: Filter; label: string; n: number }[] = [
    { id: "all", label: "All", n: all.length }, { id: "online", label: "Online now", n: online },
    { id: "paying", label: "Paying", n: paying }, { id: "free", label: "Never paid", n: all.length - paying },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon="user" label="Users" value={count(all.length)} />
        <StatTile icon="eye" label="Online now" value={count(online)} lead={online ? <LiveDot /> : undefined} />
        <StatTile icon="crown" label="Paying" value={count(paying)} note={all.length ? `${Math.round((paying / all.length) * 100)}% of users` : undefined} />
        <StatTile icon="coins" label="Total spent" value={rupees(all.reduce((s, u) => s + u.spent, 0))} />
      </div>

      {/* search, filters, sort, export */}
      <Card className="flex flex-col gap-3 p-3 md:p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <SearchBox value={search} onChange={setSearch} label="Search users" placeholder="Search by email" className="h-10 sm:max-w-xs" />
          <label className="flex items-center gap-2 text-[12.5px] text-muted sm:ml-auto">
            Sort
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} aria-label="Sort users"
              className="h-10 cursor-pointer rounded-xl border border-border bg-surface px-3 text-[13px] font-semibold text-foreground outline-none focus:border-accent">
              {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          <Button size="sm" variant="secondary" icon="download" className="h-10" onClick={() => csv(rows)} disabled={!rows.length}>Export CSV</Button>
        </div>
        <ChipRow role="radiogroup" aria-label="Show">
          {filters.map((f) => (
            <Chip key={f.id} role="radio" aria-checked={filter === f.id} on={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}<span className="rounded-full bg-surface-2 px-1.5 text-[11px] text-muted">{f.n}</span>
            </Chip>
          ))}
        </ChipRow>
      </Card>

      {!all.length ? (
        <EmptyState icon="user" title="No accounts yet" hint="People appear here as soon as they sign up." />
      ) : !rows.length ? (
        <EmptyState icon="search" title="No user matches" hint="Try another email or filter." />
      ) : (
        <>
          {/* computers: the table */}
          <Card className="hidden overflow-hidden p-0 lg:block md:p-0">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface-2/50 text-[12px] font-semibold text-muted">
                  <th scope="col" className="px-4 py-3">User</th>
                  <th scope="col" className="px-3 py-3">Activity</th>
                  <th scope="col" className="px-3 py-3">Plan</th>
                  <th scope="col" className="px-3 py-3 text-right">Credits</th>
                  <th scope="col" className="px-3 py-3 text-right">Spent</th>
                  <th scope="col" className="px-3 py-3 text-right">Reels</th>
                  <th scope="col" className="w-10 px-2 py-3"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id} onClick={() => onOpenUser(u.id)} className="cursor-pointer border-b border-border transition-colors last:border-b-0 hover:bg-accent/6">
                    <td className="px-4 py-3">
                      <span className="flex min-w-0 items-center gap-3">
                        <Avatar email={u.email} size={36} />
                        <span className="flex min-w-0 flex-col">
                          <button type="button" className="truncate text-left font-bold hover:text-accent" onClick={(e) => { e.stopPropagation(); onOpenUser(u.id); }}>{u.email}</button>
                          <span className="text-[12px] text-muted">Joined {date(u.createdAt)}</span>
                        </span>
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-muted"><Seen u={u} /><span className="block text-[12px]">{count(u.logins)} login{u.logins === 1 ? "" : "s"}</span></td>
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}><PlanPicker user={u} /></td>
                    <td className="px-3 py-3 text-right tabular-nums"><b className="text-[14px]">{u.credits === null ? "—" : count(u.credits)}</b><span className="block text-[12px] text-muted">{count(u.creditsUsed)} used</span></td>
                    <td className="px-3 py-3 text-right tabular-nums">{u.spent ? <b>{rupees(u.spent)}</b> : <span className="text-muted">₹0</span>}<span className="block text-[12px] text-muted">{u.purchases} purchase{u.purchases === 1 ? "" : "s"}</span></td>
                    <td className="px-3 py-3 text-right tabular-nums">{count(u.reels)}</td>
                    <td className="px-2 py-3 text-muted"><Icon name="chevron" size={16} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* phones and tablets: a card per person */}
          <div className="grid gap-2.5 sm:grid-cols-2 lg:hidden">
            {rows.map((u) => (
              <Card key={u.id} as="article" variant="interactive" className="flex cursor-pointer flex-col gap-3 p-3.5 md:p-3.5" onClick={() => onOpenUser(u.id)}>
                <div className="flex items-center gap-3">
                  <Avatar email={u.email} size={40} />
                  <div className="min-w-0 flex-1">
                    <b className="block truncate text-[14px]">{u.email}</b>
                    <span className="text-[12px] text-muted"><Seen u={u} /></span>
                  </div>
                  <Icon name="chevron" size={16} className="text-muted" />
                </div>
                <div className="grid grid-cols-3 gap-2 rounded-xl bg-surface-2/60 p-2.5 text-center">
                  <span><b className="block tabular-nums">{u.credits === null ? "—" : count(u.credits)}</b><span className="text-[11px] text-muted">credits left</span></span>
                  <span><b className="block tabular-nums">{u.spent ? rupees(u.spent) : "₹0"}</b><span className="text-[11px] text-muted">spent</span></span>
                  <span><b className="block tabular-nums">{count(u.reels)}</b><span className="text-[11px] text-muted">Reels</span></span>
                </div>
                <div className="flex items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
                  <span className="text-[12px] text-muted">Joined {date(u.createdAt)} · {count(u.logins)} login{u.logins === 1 ? "" : "s"}</span>
                  <PlanPicker user={u} />
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** The person's plan, and "Change": Free, or a paid plan for a month or a year (its credits come with it, no payment),
 * asked first. */
function PlanPicker({ user }: { user: AdminUserRow }) {
  const qc = useQueryClient();
  const plans = useQuery({ queryKey: ["plans"], queryFn: api.plans });
  const set = useMutation({
    mutationFn: ({ plan, months }: { plan: string; months: number }) => api.adminSetPlan(user.id, plan, months),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["admin", "users"] }); void qc.invalidateQueries({ queryKey: ["admin", "user", user.id] }); },
  });
  const list = plans.data?.plans ?? [];
  const choose = async (v: string) => {
    if (!v) return;
    const [plan, m] = v.split(":"), months = Number(m || 1), p = list.find((x) => x.id === plan);
    const what = plan === "free" ? "the Free plan (Shubix AI off; their credits stay)" : `${p?.name ?? plan} for ${months === 12 ? "1 year" : "1 month"} (${p?.credits ?? 0} credits a month, no payment)`;
    if (await confirmAction({ title: `Change ${user.email}'s plan?`, body: `They move to ${what}.`, ok: "Change plan" })) set.mutate({ plan, months });
  };
  const paid = user.plan !== "free";
  return (
    <span className="inline-flex items-center gap-2">
      <Badge tone={paid ? "brand" : "neutral"} className="h-6 px-2.5">{paid && <Icon name="crown" size={12} />}{set.isPending ? "Saving…" : user.planName}</Badge>
      <label className="relative inline-flex">
        <span className="pointer-events-none inline-flex h-7 items-center gap-1 rounded-lg border border-border bg-surface px-2 text-[11.5px] font-semibold text-muted">Change<Icon name="down" size={12} /></span>
        <select aria-label={`Change the plan of ${user.email}`} value="" disabled={set.isPending || !list.length} onChange={(e) => void choose(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0">
          <option value="">Change plan…</option>
          {list.map((p) => p.id === "free"
            ? <option key="free" value="free:1">Free</option>
            : [<option key={p.id + "1"} value={`${p.id}:1`}>{p.name} · 1 month</option>, <option key={p.id + "12"} value={`${p.id}:12`}>{p.name} · 1 year</option>])}
        </select>
      </label>
      {set.error && <span className="text-[11px] text-danger" title={errorMessage(set.error)}>Failed</span>}
    </span>
  );
}
