"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { DEFAULT_LOCKS, PLANS, PLAN_NAME, planRank, type PlanId, type PlanLocks } from "@shubix/core/lib/plan-locks";
import { Card } from "@/components/atoms";
import type { TFn } from "@/hooks/useApi";

/** "What each plan unlocks": made from the administrator's plan locks, so this table always says what the studio does.
 * Libraries show how many of their items each plan opens; tools and export rules show ✓ or the value. */
const RES: Record<string, string> = { "720": "720p", "1080": "1080p", "4k": "4K" };
export function PlanCompare({ plans, t }: { plans?: string[]; t: TFn }) {
  const cols = PLANS.filter((p) => !plans || plans.includes(p)); // the plans the pricing page shows (a hidden plan has no column)
  const q = useQuery({ queryKey: ["plan-locks"], queryFn: api.planLocks, staleTime: 300_000 });
  const L: PlanLocks = q.data ?? DEFAULT_LOCKS;
  const opens = (p: PlanId, plan: PlanId) => planRank(plan) <= planRank(p);
  const isTools = (id: string) => id === "studio" || id === "tool";   // ✓ per plan, not a count
  const libs = L.groups.filter((g) => !isTools(g.id));
  const tools = L.groups.filter((g) => isTools(g.id)).flatMap((g) => g.items);
  // phones: the names wrap and the plans keep their room (a table only scrolls sideways with four plans); the names stay
  // while the plans scroll
  const cell = "px-1.5 py-2 text-center whitespace-nowrap md:px-2", head = "sticky left-0 z-[1] bg-[var(--surface)] py-2 pl-1 pr-2 text-left font-medium leading-snug md:px-2";
  return (
    <Card as="section" aria-label={t("pricing.compareTitle")} className="flex flex-col gap-3">
      <div>
        <h2 className="m-0 font-[family-name:var(--font-display)] text-[19px] font-semibold tracking-[-0.015em] md:text-[22px]">{t("pricing.compareTitle")}</h2>
        <p className="m-0 text-sm text-muted">{t("pricing.compareSub")}</p>
      </div>
      <div className="overflow-x-auto">
        <table className={`w-full border-collapse text-[12.5px] md:text-sm ${cols.length > 3 ? "min-w-[460px]" : ""}`}>
          <thead><tr className="border-b border-border"><th className={head}></th>{cols.map((p) => <th key={p} className={cell}>{PLAN_NAME[p]}</th>)}</tr></thead>
          <tbody>
            {libs.map((g) => (
              <tr key={g.id} className="border-b border-border">
                <td className={head}>{g.name}</td>
                {cols.map((p) => { const n = g.items.filter((it) => opens(p, it.plan)).length; return <td key={p} className={cell}>{n === g.items.length ? `All ${n}` : `${n} of ${g.items.length}`}</td>; })}
              </tr>))}
            {tools.map((it) => (
              <tr key={it.key} className="border-b border-border">
                <td className={head}>{it.plan !== "free" ? "👑 " : ""}{it.name}</td>
                {cols.map((p) => <td key={p} className={cell}>{opens(p, it.plan) ? "✓" : "—"}</td>)}
              </tr>))}
            <tr className="border-b border-border"><td className={head}>{t("pricing.rowQuality")}</td>{cols.map((p) => <td key={p} className={cell}>{RES[L.export[p].maxRes]}</td>)}</tr>
            <tr className="border-b border-border"><td className={head}>{t("pricing.row60")}</td>{cols.map((p) => <td key={p} className={cell}>{L.export[p].fps60 ? "✓" : "—"}</td>)}</tr>
            <tr><td className={head}>{t("pricing.rowWatermark")}</td>{cols.map((p) => <td key={p} className={cell}>{L.export[p].noWatermark ? "✓" : "—"}</td>)}</tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}
