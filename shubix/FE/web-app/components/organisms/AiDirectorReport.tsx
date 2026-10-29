"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, Heading, Spinner } from "@/components/atoms";
import { ErrorBanner } from "@/components/molecules";
import { StatTile } from "@/components/molecules/StatTile";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";

const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)}%`);
const kept = (rate: number | null) => (rate === null ? "–" : `${Math.round((1 - rate) * 100)}%`);

/** Administration → AI director: is the AI a good editor? How many Reels it planned, what it chose, and how often people
 * changed its choices (lower is better). `bare`: inside a panel (no card, no heading). */
export function AiDirectorReport({ bare = false }: { bare?: boolean }) {
  const q = useQuery({ queryKey: ["ai-director-report"], queryFn: api.aiDirectorReport });
  const r = q.data;
  return (
    <Card as="section" aria-label="AI director" className={cn("flex flex-col gap-3", bare && "border-0 bg-transparent p-0 shadow-none md:p-0")}>
      {!bare && <Heading size="section" as="h2">AI director</Heading>}
      <p className="m-0 text-[12.5px] text-muted">With the AI director on, the AI chooses the pace, every shot, transition, effect and the keyframes on the hits. This shows how often people kept what it chose (last {r?.days ?? 30} days).</p>
      {q.isLoading && <Spinner size="sm" />}
      {q.error && <ErrorBanner message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {r && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <StatTile icon="reels" label="Reels planned" value={r.plans} />
            <StatTile icon="user" label="People" value={r.creators} />
            <StatTile icon="layers" label="Transitions kept" value={kept(r.changeRate.transitions)} />
            <StatTile icon="sparkle" label="Effects kept" value={kept(r.changeRate.effects)} />
          </div>
          <Card className="flex flex-col divide-y divide-border p-0 text-[13px] md:p-0">
            {[
              ["Cuts", r.cuts], ["New mix calls", r.mixes], ["Special transitions", r.choices.transitions], ["Effects", r.choices.effects], ["Keyframes on hits", r.choices.keys],
              ["Seconds per plan", r.avgSeconds ?? "–"], ["Not answered (the phone's own edit was used)", r.failed],
              ["Transitions changed by people", `${r.changed.transitions} (${pct(r.changeRate.transitions)})`], ["Effects changed by people", `${r.changed.effects} (${pct(r.changeRate.effects)})`],
            ].map(([k, v]) => (
              <div key={String(k)} className="flex items-center justify-between gap-3 px-3.5 py-2.5"><span className="text-muted">{k}</span><b className="tabular-nums">{v}</b></div>
            ))}
          </Card>
        </>
      )}
    </Card>
  );
}
