"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { DEFAULT_LOCKS, PLANS, PLAN_NAME, planRank, type PlanId, type PlanLocks } from "@/lib/plan-locks";
import { Card } from "@/components/atoms";

/** "What each plan unlocks": made from the administrator's plan locks, so this table always says what the studio does.
 * Libraries show how many of their items each plan opens; tools and export rules show ✓ or the value. */
const RES: Record<string, string> = { "720": "720p", "1080": "1080p", "4k": "4K" };
export function PlanCompare() {
  const q = useQuery({ queryKey: ["plan-locks"], queryFn: api.planLocks, staleTime: 300_000 });
  const L: PlanLocks = q.data ?? DEFAULT_LOCKS;
  const opens = (p: PlanId, plan: PlanId) => planRank(plan) <= planRank(p);
  const libs = L.groups.filter((g) => g.id !== "tool");
  const tools = L.groups.find((g) => g.id === "tool")?.items ?? [];
  const cell = "px-2 py-2 text-center whitespace-nowrap", head = "sticky left-0 z-[1] bg-[var(--surface)] px-2 py-2 text-left font-medium";   // the names stay while the plans scroll on a phone
  return (
    <Card as="section" aria-label="What each plan unlocks" className="flex flex-col gap-3">
      <div>
        <h2 className="m-0 font-[family-name:var(--font-display)] text-[22px] font-extrabold md:text-[26px]">What each plan unlocks</h2>
        <p className="m-0 text-sm text-muted">The whole editor is free. 👑 items can be tried by everyone; exporting with them needs their plan.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead><tr className="border-b border-border"><th className={head}></th>{PLANS.map((p) => <th key={p} className={cell}>{PLAN_NAME[p]}</th>)}</tr></thead>
          <tbody>
            {libs.map((g) => (
              <tr key={g.id} className="border-b border-border">
                <td className={head}>{g.name}</td>
                {PLANS.map((p) => { const n = g.items.filter((it) => opens(p, it.plan)).length; return <td key={p} className={cell}>{n === g.items.length ? `All ${n}` : `${n} of ${g.items.length}`}</td>; })}
              </tr>))}
            {tools.map((it) => (
              <tr key={it.key} className="border-b border-border">
                <td className={head}>{it.plan !== "free" ? "👑 " : ""}{it.name}</td>
                {PLANS.map((p) => <td key={p} className={cell}>{opens(p, it.plan) ? "✓" : "—"}</td>)}
              </tr>))}
            <tr className="border-b border-border"><td className={head}>Best export quality</td>{PLANS.map((p) => <td key={p} className={cell}>{RES[L.export[p].maxRes]}</td>)}</tr>
            <tr className="border-b border-border"><td className={head}>60 fps</td>{PLANS.map((p) => <td key={p} className={cell}>{L.export[p].fps60 ? "✓" : "—"}</td>)}</tr>
            <tr><td className={head}>No watermark</td>{PLANS.map((p) => <td key={p} className={cell}>{L.export[p].noWatermark ? "✓" : "—"}</td>)}</tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}
