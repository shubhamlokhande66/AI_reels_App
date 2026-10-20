"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon, Spinner } from "@/components/atoms";
import { EmptyState, ErrorBanner } from "@/components/molecules";
import { api, errorMessage } from "@/lib/api";
import type { AdminUserRow } from "@/types/api";
import { ago, count, date, rupees } from "./format";
import { LiveDot } from "./OverviewTab";

type Filter = "all" | "online" | "paying" | "free";
type SortKey = "email" | "createdAt" | "lastLoginAt" | "lastSeenAt" | "logins" | "credits" | "creditsUsed" | "spent" | "reels";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "online", label: "Online now" },
  { id: "paying", label: "Paying" },
  { id: "free", label: "Free" },
];
const COLUMNS: { key: SortKey; label: string; num?: boolean }[] = [
  { key: "email", label: "User" },
  { key: "createdAt", label: "Joined" },
  { key: "lastLoginAt", label: "Last login" },
  { key: "lastSeenAt", label: "Last seen" },
  { key: "logins", label: "Logins", num: true },
  { key: "credits", label: "Credits left", num: true },
  { key: "creditsUsed", label: "Used", num: true },
  { key: "spent", label: "Spent", num: true },
  { key: "reels", label: "Reels", num: true },
];

export const useAdminUsers = () => useQuery({ queryKey: ["admin", "users"], queryFn: api.adminUsers, refetchInterval: 60_000 });

const value = (u: AdminUserRow, k: SortKey): string | number => {
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

export function UsersTab({ onOpenUser }: { onOpenUser: (id: string) => void }) {
  const q = useAdminUsers();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "createdAt", desc: true });
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? [])
      .filter((u) => !s || u.email.toLowerCase().includes(s))
      .filter((u) => filter === "all" || (filter === "online" ? u.online : filter === "paying" ? u.spent > 0 : u.spent === 0))
      .sort((a, b) => {
        const x = value(a, sort.key), y = value(b, sort.key);
        return (x < y ? -1 : x > y ? 1 : 0) * (sort.desc ? -1 : 1);
      });
  }, [q.data, search, filter, sort]);

  if (q.isLoading) return <Spinner label="Loading users…" />;
  if (q.error || !q.data) return <ErrorBanner message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const all = q.data;
  const online = all.filter((u) => u.online).length, paying = all.filter((u) => u.spent > 0).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Users", count(all.length)],
          ["Online now", count(online)],
          ["Paying", count(paying)],
          ["Total spent", rupees(all.reduce((s, u) => s + u.spent, 0))],
        ].map(([label, v]) => (
          <div key={label} className="stat" style={{ gridTemplateColumns: "1fr" }}>
            <b>{v}</b>
            <span className="mu xs">{label}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <label className="srch md:w-80">
          <Icon name="search" size={16} />
          <input type="search" placeholder="Search by email" aria-label="Search users" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <div className="chips" role="radiogroup" aria-label="Show">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" role="radio" aria-checked={filter === f.id} className={`chip ${filter === f.id ? "on" : ""}`} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn sm md:ml-auto" onClick={() => csv(rows)} disabled={!rows.length}>
          <Icon name="download" size={16} />
          Export CSV
        </button>
      </div>

      {!all.length ? (
        <EmptyState title="No accounts yet" hint="People appear here as soon as they sign up." />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[920px] border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-border">
                {COLUMNS.map((c) => (
                  <th key={c.key} scope="col" className={`px-3 py-2.5 ${c.num ? "text-right" : ""}`} aria-sort={sort.key === c.key ? (sort.desc ? "descending" : "ascending") : "none"}>
                    <button
                      type="button"
                      className={`eb inline-flex items-center gap-1 hover:text-foreground ${sort.key === c.key ? "text-foreground" : ""}`}
                      onClick={() => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : c.key !== "email" }))}
                    >
                      {c.label}
                      {sort.key === c.key && <Icon name="down" size={12} className={sort.desc ? "" : "rotate-180"} />}
                    </button>
                  </th>
                ))}
                <th scope="col" className="px-3 py-2.5">
                  <span className="eb">Plan</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} onClick={() => onOpenUser(u.id)} className="cursor-pointer border-b border-border last:border-b-0 hover:bg-[var(--chip-on)]">
                  <td className="max-w-[260px] px-3 py-2.5">
                    <button type="button" className="row w-full min-w-0 gap-2 text-left font-bold" onClick={(e) => { e.stopPropagation(); onOpenUser(u.id); }}>
                      {u.online ? <LiveDot /> : <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-surface-2" aria-hidden />}
                      <span className="truncate">{u.email}</span>
                      {u.online && <span className="sr-only">(online now)</span>}
                    </button>
                  </td>
                  <td className="mu whitespace-nowrap px-3 py-2.5">{date(u.createdAt)}</td>
                  <td className="mu whitespace-nowrap px-3 py-2.5">{ago(u.lastLoginAt)}</td>
                  <td className="mu whitespace-nowrap px-3 py-2.5">{u.online ? <span className="text-success">online</span> : ago(u.lastSeenAt)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{count(u.logins)}</td>
                  <td className="px-3 py-2.5 text-right font-bold tabular-nums">{u.credits === null ? "—" : count(u.credits)}</td>
                  <td className="mu px-3 py-2.5 text-right tabular-nums">{count(u.creditsUsed)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {u.spent ? rupees(u.spent) : "—"}
                    {u.purchases > 0 && <span className="mu block text-[11px]">{u.purchases} purchase{u.purchases === 1 ? "" : "s"}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{count(u.reels)}</td>
                  <td className="px-3 py-2.5">
                    <span className={`badge ${u.plan === "free" ? "" : "b-run"}`}>{u.planName}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <p className="mu sm p-4 text-center">No user matches.</p>}
        </div>
      )}
    </div>
  );
}
