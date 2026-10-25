"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { PLAN_NAME, PLANS } from "@/lib/plan-locks";
import { Badge, Button, Card, Heading, Input, Spinner } from "@/components/atoms";
import { ErrorBanner, Field } from "@/components/molecules";
import { cn } from "@/lib/cn";

/** Admin → Settings → My Reels storage: how long a Reel saved to My Reels is kept, per plan (0 = until the person
 * deletes it). Keeps the storage (R2) inside its free 10 GB; the people on a plan with a limit see it in My Reels.
 * Old Reels go within about 6 hours. */
export function ReelsKeepSettings({ bare = false }: { bare?: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["reels-keep"], queryFn: api.reelsKeep });
  const [draft, setDraft] = useState<Record<string, number> | null>(null);
  const [saved, setSaved] = useState(false);
  const save = useMutation({ mutationFn: api.setReelsKeep, onSuccess: (d) => { qc.setQueryData(["reels-keep"], d); setDraft(null); setSaved(true); } });
  if (q.error) return <ErrorBanner message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Spinner size="sm" label="Loading My Reels storage…" />;
  const days = draft ?? q.data.days;
  return (
    <Card as="section" aria-label="My Reels storage" className={cn("flex flex-col gap-3", bare && "border-0 bg-transparent p-0 shadow-none md:p-0")}>
      <div className={bare ? "hidden" : undefined}>
        <Heading size="section" as="h2">My Reels storage</Heading>
        <p className="m-0 text-[12.5px] text-muted">How long a Reel saved to My Reels is kept, per plan. Older Reels (their file and share link) are removed within about 6 hours; people on a plan with a limit see it in My Reels.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {PLANS.map((p) => {
          const d = days[p] ?? 0;
          return (
            <div key={p} className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface-2/50 p-3">
              <div className="flex items-center justify-between gap-2">
                <b className="text-[13.5px]">{PLAN_NAME[p]}</b>
                <Badge tone={d ? "neutral" : "success"}>{d ? `${d} day${d === 1 ? "" : "s"}` : "Until they delete it"}</Badge>
              </div>
              <Field label="Keep for (days, 0 = always)">
                <Input type="number" min={0} max={3650} step={1} aria-label={`${PLAN_NAME[p]}: keep days`} value={d}
                  onChange={(e) => { setSaved(false); setDraft({ ...days, [p]: Math.max(0, Math.min(3650, Math.round(+e.target.value || 0))) }); }} />
              </Field>
              <span className="text-[12px] text-muted">Up to {q.data.limits[p] ?? "–"} Reels saved</span>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {save.error ? <span className="mr-auto text-[13px] text-danger">{errorMessage(save.error)}</span> : saved && <span className="mr-auto text-[13px] font-semibold text-success">✓ Saved</span>}
        {draft && <Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button>}
        <Button icon="check" disabled={!draft} loading={save.isPending} onClick={() => save.mutate(days)}>Save</Button>
      </div>
    </Card>
  );
}
