"use client";

import { useQuery } from "@tanstack/react-query";
import { ErrorBanner } from "@/components/molecules";
import { api, errorMessage } from "@/lib/api";

const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)}%`);

/** Administration → AI director: is the AI a good editor? How many Reels it planned, what it chose, and how often people
 * changed its choices (lower is better). */
export function AiDirectorReport() {
  const q = useQuery({ queryKey: ["ai-director-report"], queryFn: api.aiDirectorReport });
  const r = q.data;
  const kept = (rate: number | null) => (rate === null ? "–" : `${Math.round((1 - rate) * 100)}%`);
  return (
    <section className="card" aria-label="AI director">
      <div className="between">
        <span className="h2">AI director</span>
        <span className="mu xs">last {r?.days ?? 30} days</span>
      </div>
      <span className="mu sm">With the AI director on, the AI chooses the pace, every shot, transition, effect and the keyframes on the hits. This shows how often people kept what it chose.</span>
      {r && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Reels planned", String(r.plans)],
            ["People", String(r.creators)],
            ["Transitions kept", kept(r.changeRate.transitions)],
            ["Effects kept", kept(r.changeRate.effects)],
          ].map(([k, v]) => (
            <div key={k} className="flex flex-col gap-0.5 rounded-lg border border-border p-2.5">
              <span className="mu xs">{k}</span>
              <span className="h2 tabular-nums">{v}</span>
            </div>
          ))}
        </div>
      )}
      {r && (
        <span className="mu xs">
          {r.cuts} cuts · {r.mixes} New mix calls · {r.choices.transitions} special transitions · {r.choices.effects} effects · {r.choices.keys} keyframes on hits
          {r.avgSeconds !== null ? ` · ${r.avgSeconds} s per plan` : ""}
          {r.failed ? ` · ${r.failed} not answered (the phone's own edit was used)` : ""}
          {r.changed.transitions + r.changed.effects ? ` · changed by people: ${r.changed.transitions} transitions (${pct(r.changeRate.transitions)}), ${r.changed.effects} effects (${pct(r.changeRate.effects)})` : ""}
        </span>
      )}
      {q.isLoading && <span className="mu xs">Loading…</span>}
      {q.error && <ErrorBanner message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
    </section>
  );
}
