"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { PLAN_NAME, type PlanId } from "@/lib/plan-locks";
import { btnPrimary, Card } from "@/components/atoms";
import { ErrorBanner } from "@/components/molecules";

/** Admin: how long a Reel saved to My Reels is kept, per plan (0 = until the person deletes it). Keeps the storage (R2)
 * inside its free 10 GB; the people on a plan with a limit see it in My Reels. Old Reels go within about 6 hours. */
const PLANS = ["free", "creator", "pro", "business"] as const;
export function ReelsKeepSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["reels-keep"], queryFn: api.reelsKeep });
  const [draft, setDraft] = useState<Record<string, number> | null>(null);
  const save = useMutation({ mutationFn: api.setReelsKeep, onSuccess: (d) => { qc.setQueryData(["reels-keep"], d); setDraft(null); } });
  if (q.error) return <ErrorBanner message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Card><p className="mu sm">Loading…</p></Card>;
  const days = draft ?? q.data.days;
  return (
    <Card>
      <h3 className="m-0 text-base font-semibold">My Reels: how long a saved Reel is kept</h3>
      <p className="mu sm m-0">0 = until the person deletes it. Older Reels are removed within about 6 hours (their file and their share link). People on a plan with a limit see it in My Reels.</p>
      <table className="mt-2 w-full text-sm">
        <thead><tr className="text-left"><th className="py-1 font-medium">Plan</th><th className="py-1 font-medium">Keep (days)</th><th className="py-1 font-medium">Reels at most</th></tr></thead>
        <tbody>
          {PLANS.map((p) => (
            <tr key={p}>
              <td className="py-1">{PLAN_NAME[p as PlanId] ?? p}</td>
              <td className="py-1"><input type="number" min={0} max={3650} step={1} aria-label={`${p} keep days`} className="w-24" value={days[p] ?? 0}
                onChange={(e) => setDraft({ ...days, [p]: Math.max(0, Math.min(3650, Math.round(+e.target.value || 0))) })} /></td>
              <td className="py-1 mu">{q.data.limits[p] ?? "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {save.error && <p className="m-0 text-sm text-danger">{errorMessage(save.error)}</p>}
      <div className="mt-2 flex gap-2">
        <button type="button" className={btnPrimary} disabled={!draft || save.isPending} onClick={() => save.mutate(days)}>{save.isPending ? "Saving…" : "Save"}</button>
        {draft && <button type="button" className="btn" onClick={() => setDraft(null)}>Cancel</button>}
      </div>
    </Card>
  );
}
