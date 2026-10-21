"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { PLANS, PLAN_NAME, type LockOverrides, type PlanId, type PlanLocks } from "@/lib/plan-locks";
import { btnPrimary, Card } from "@/components/atoms";
import { ErrorBanner } from "@/components/molecules";

/** Admin: which plan unlocks each effect, transition, filter, font, text style and tool of Fast Studio, and what each
 * plan may export. Free items are open to everyone; a crowned item can be tried, and asks for its plan at export. */
export function PlanLockSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["plan-locks"], queryFn: api.planLocks });
  const [draft, setDraft] = useState<PlanLocks | null>(null);
  const L = draft ?? q.data;
  const save = useMutation({
    mutationFn: (x: PlanLocks) => {
      const items: Record<string, PlanId> = {}; for (const g of x.groups) for (const it of g.items) items[`${g.id}:${it.key}`] = it.plan;
      return api.setPlanLocks({ items, export: x.export } as LockOverrides);
    },
    onSuccess: (d) => { qc.setQueryData(["plan-locks"], d); setDraft(null); },
  });
  if (q.isLoading || !L) return <Card><p className="mu sm">Loading plan locks…</p></Card>;
  const edit = (fn: (x: PlanLocks) => void) => { const x = structuredClone(L); fn(x); setDraft(x); };
  const count = (p: PlanId) => L.groups.reduce((n, g) => n + g.items.filter((it) => it.plan === p).length, 0);
  return (
    <div className="flex flex-col gap-3">
      {q.error && <ErrorBanner message={errorMessage(q.error)} />}
      <Card>
        <h3 className="m-0 text-base font-semibold">What each plan may export</h3>
        <p className="mu sm m-0">Free items: {count("free")} · Creator: {count("creator")} · Pro: {count("pro")} · Business: {count("business")}</p>
        <div className="mt-2 overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-left"><th>Plan</th><th>Best quality</th><th>60 fps</th><th>No watermark</th></tr></thead>
          <tbody>{PLANS.map((p) => (
            <tr key={p}><td className="py-1 font-medium">{PLAN_NAME[p]}</td>
              <td><select aria-label={`${PLAN_NAME[p]} best quality`} value={L.export[p].maxRes} onChange={(e) => edit((x) => { x.export[p].maxRes = e.target.value as "720" | "1080" | "4k"; })}>
                <option value="720">720p</option><option value="1080">1080p</option><option value="4k">4K</option></select></td>
              <td><input type="checkbox" aria-label={`${PLAN_NAME[p]} 60 fps`} checked={L.export[p].fps60} onChange={(e) => edit((x) => { x.export[p].fps60 = e.target.checked; })} /></td>
              <td><input type="checkbox" aria-label={`${PLAN_NAME[p]} without watermark`} checked={L.export[p].noWatermark} onChange={(e) => edit((x) => { x.export[p].noWatermark = e.target.checked; })} /></td></tr>))}</tbody>
        </table></div>
      </Card>
      {L.groups.map((g, gi) => (
        <Card key={g.id}>
          <h3 className="m-0 text-base font-semibold">{g.name}</h3>
          {g.id === "studio" && <p className="mu sm m-0">The editor&apos;s tool bar: on a lower plan the tool shows its plan&apos;s tag and a tap opens the pricing page.</p>}
          <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
            {g.items.map((it, ii) => (
              <label key={it.key} className="flex items-center justify-between gap-2 text-sm">
                <span>{it.plan !== "free" ? "👑 " : ""}{it.name}</span>
                <select aria-label={`${it.name} plan`} value={it.plan} onChange={(e) => edit((x) => { x.groups[gi].items[ii].plan = e.target.value as PlanId; })}>
                  {PLANS.map((p) => <option key={p} value={p}>{PLAN_NAME[p]}</option>)}
                </select>
              </label>))}
          </div>
        </Card>))}
      {save.error && <ErrorBanner message={errorMessage(save.error)} />}
      <div className="flex gap-2"><button type="button" className={btnPrimary} disabled={!draft || save.isPending} onClick={() => save.mutate(L)}>{save.isPending ? "Saving…" : "Save plan locks"}</button>
        {draft && <button type="button" className="btn" onClick={() => setDraft(null)}>Undo changes</button>}</div>
    </div>
  );
}
