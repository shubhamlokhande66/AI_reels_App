"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { PLANS, PLAN_NAME, type LockOverrides, type PlanId, type PlanLocks } from "@/lib/plan-locks";
import { Button, Card, Heading, Icon, Spinner, Toggle } from "@/components/atoms";
import { ErrorBanner, SearchBox, Segmented } from "@/components/molecules";

/** Admin → CMS → Plan locks: which plan unlocks each page, tool, effect, transition, filter, font and text style, and
 * what each plan may export. Free items are open to everyone; a crowned item can be tried, and asks for its plan at
 * export. Changes are kept here until "Save plan locks". */

const PLAN_OPTIONS = PLANS.map((p) => ({ value: p, label: PLAN_NAME[p] }));
const QUALITY = [{ value: "720", label: "720p" }, { value: "1080", label: "1080p" }, { value: "4k", label: "4K" }] as const;
const PLAN_ICON: Record<PlanId, string> = { free: "sparkle", creator: "bolt", pro: "crown", business: "bag" };
// what each group is, in a line
const GROUP_HINT: Record<string, string> = {
  page: "Whole pages: on a lower plan the Home card and the menu show the Upgrade tag, and the page asks to upgrade.",
  studio: "The editor's tool bar: on a lower plan the tool shows its tag and a tap opens the plans.",
};

export function PlanLockSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["plan-locks"], queryFn: api.planLocks });
  const [draft, setDraft] = useState<PlanLocks | null>(null);
  const [find, setFind] = useState("");
  const [saved, setSaved] = useState(false);
  const L = draft ?? q.data;
  const save = useMutation({
    mutationFn: (x: PlanLocks) => {
      const items: Record<string, PlanId> = {};
      for (const g of x.groups) for (const it of g.items) items[`${g.id}:${it.key}`] = it.plan;
      return api.setPlanLocks({ items, export: x.export } as LockOverrides);
    },
    onSuccess: (d) => { qc.setQueryData(["plan-locks"], d); setDraft(null); setSaved(true); },
  });
  if (q.isLoading || !L) return <Spinner label="Loading plan locks…" />;

  const edit = (fn: (x: PlanLocks) => void) => { const x = structuredClone(L); fn(x); setDraft(x); setSaved(false); };
  const count = (p: PlanId) => L.groups.reduce((n, g) => n + g.items.filter((it) => it.plan === p).length, 0);
  // what differs from the saved locks
  const changes = !draft || !q.data ? 0
    : draft.groups.reduce((n, g, gi) => n + g.items.filter((it, ii) => it.plan !== q.data!.groups[gi].items[ii].plan).length, 0)
      + PLANS.filter((p) => JSON.stringify(draft.export[p]) !== JSON.stringify(q.data!.export[p])).length;
  const needle = find.trim().toLowerCase();

  return (
    <div className="flex flex-col gap-4">
      {q.error && <ErrorBanner message={errorMessage(q.error)} />}

      {/* what each plan opens */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {PLANS.map((p) => (
          <Card key={p} className="flex items-center gap-3 p-3 md:p-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/12 text-accent"><Icon name={PLAN_ICON[p]} size={18} /></span>
            <span className="min-w-0">
              <b className="block font-[family-name:var(--font-display)] text-[20px] leading-none">{count(p)}</b>
              <span className="text-[12px] text-muted">{p === "free" ? "open to everyone" : `need ${PLAN_NAME[p]}`}</span>
            </span>
          </Card>
        ))}
      </div>

      {/* export rules */}
      <Card as="section" aria-label="What each plan may export" className="flex flex-col gap-3">
        <div>
          <Heading size="section" as="h3">What each plan may export</Heading>
          <p className="m-0 text-[12.5px] text-muted">The best quality, 60 fps and the watermark, plan by plan.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {PLANS.map((p) => (
            <div key={p} className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2/50 p-3">
              <b className="text-[13.5px]">{PLAN_NAME[p]}</b>
              <Segmented label={`${PLAN_NAME[p]}: best quality`} options={QUALITY} value={L.export[p].maxRes} onChange={(v) => edit((x) => { x.export[p].maxRes = v; })} />
              <Toggle label="60 fps" on={L.export[p].fps60} onChange={(v) => edit((x) => { x.export[p].fps60 = v; })} />
              <Toggle label="No watermark" on={L.export[p].noWatermark} onChange={(v) => edit((x) => { x.export[p].noWatermark = v; })} />
            </div>
          ))}
        </div>
      </Card>

      <SearchBox value={find} onChange={setFind} label="Find a page, tool, effect, font…" className="md:max-w-md" />

      {/* the groups: each item and the plan it needs */}
      {L.groups.map((g, gi) => {
        const items = g.items.map((it, ii) => ({ it, ii })).filter(({ it }) => !needle || it.name.toLowerCase().includes(needle));
        if (!items.length) return null;
        return (
          <Card key={g.id} as="section" aria-label={g.name} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <Heading size="section" as="h3">{g.name}</Heading>
                <p className="m-0 text-[12px] text-muted">{GROUP_HINT[g.id] ?? `${g.items.length} items · ${g.items.filter((it) => it.plan !== "free").length} need a plan`}</p>
              </div>
              {/* the whole group at once */}
              <label className="flex items-center gap-2 text-[12px] text-muted">
                Set all to
                <select aria-label={`${g.name}: set all to`} value="" onChange={(e) => { const v = e.target.value as PlanId; if (v) edit((x) => { for (const it of x.groups[gi].items) it.plan = v; }); }}
                  className="h-8 cursor-pointer rounded-lg border border-border bg-surface px-2 text-[12px] font-bold text-foreground outline-none focus:border-accent">
                  <option value="">…</option>
                  {PLANS.map((p) => <option key={p} value={p}>{PLAN_NAME[p]}</option>)}
                </select>
              </label>
            </div>
            <div className="grid gap-x-6 lg:grid-cols-2">
              {items.map(({ it, ii }) => (
                <div key={it.key} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 last:border-b-0 lg:[&:nth-last-child(2):nth-child(odd)]:border-b-0">
                  <span className={cn("flex min-w-0 items-center gap-1.5 text-[13px]", it.plan === "free" ? "text-foreground" : "font-semibold")}>
                    {it.plan !== "free" && <Icon name="crown" size={13} color="#f5c84c" />}
                    <span className="min-w-0">{it.name}</span>
                  </span>
                  <Segmented size="sm" label={`${it.name}: plan`} options={PLAN_OPTIONS} value={it.plan} onChange={(v) => edit((x) => { x.groups[gi].items[ii].plan = v; })} />
                </div>
              ))}
            </div>
          </Card>
        );
      })}
      {needle && L.groups.every((g) => !g.items.some((it) => it.name.toLowerCase().includes(needle))) && <p className="m-0 text-center text-[13px] text-muted">Nothing matches “{find.trim()}”.</p>}

      {/* save */}
      <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-end gap-3 rounded-2xl border border-border bg-[var(--bar)] px-4 py-3 shadow-[var(--shadow)] backdrop-blur">
        {save.error ? <span className="mr-auto text-[13px] text-danger">{errorMessage(save.error)}</span>
          : <span className={cn("mr-auto text-[13px]", changes ? "font-bold text-warning" : "text-muted")}>{changes ? `${changes} change${changes === 1 ? "" : "s"} not saved` : saved ? "✓ Saved: the studio and the pricing page follow them" : "All saved"}</span>}
        {draft && <Button variant="secondary" onClick={() => setDraft(null)} disabled={save.isPending}>Undo changes</Button>}
        <Button icon="check" disabled={!draft} loading={save.isPending} onClick={() => save.mutate(L)}>Save plan locks</Button>
      </div>
    </div>
  );
}
