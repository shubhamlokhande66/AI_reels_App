"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Card, Heading, Icon } from "@/components/atoms";
import { ErrorBanner } from "@/components/molecules";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { DEFAULTS, FEATURE_LIST, type FeatureKey } from "@/lib/features-list";

const ICON: Record<FeatureKey, string> = { fastStudio: "sparkle", studioAI: "wand", brands: "star" };

/** Administration → Settings → Features: show or hide each part of the app for everyone. A hidden part leaves the
 * menus and the dashboard, its page says it is off, and the server refuses its work (for anyone but the administrator). */
export function FeatureSettings({ bare = false }: { bare?: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["features"], queryFn: api.features });
  const save = useMutation({
    mutationFn: (p: { key: FeatureKey; on: boolean }) => api.setFeatures({ [p.key]: p.on }),
    onSuccess: (f) => qc.setQueryData(["features"], f),
  });
  const f = q.data ?? DEFAULTS;
  const on = FEATURE_LIST.filter((x) => f[x.key]).length;
  return (
    <Card as="section" aria-label="Features" className={cn("flex flex-col gap-1", bare && "border-0 bg-transparent p-0 shadow-none md:p-0")}>
      <div className={cn("mb-2 flex flex-wrap items-center gap-2", bare && "hidden")}>
        <div className="min-w-0 flex-1">
          <Heading size="section" as="h2">Features</Heading>
          <p className="m-0 text-[12.5px] text-muted">What people see. A part that is off leaves the menu and the dashboard, and the server stops its work.</p>
        </div>
        <Badge tone="brand">{on} of {FEATURE_LIST.length} on</Badge>
      </div>
      {FEATURE_LIST.map((x) => (
        <div key={x.key} className="flex items-start gap-3 border-t border-border py-3.5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent"><Icon name={ICON[x.key]} size={19} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <b className="text-[14px]">{x.label}</b>
              <Badge tone={x.server ? "brand" : "success"}>{x.server ? "Uses the server" : "Runs on the phone"}</Badge>
            </div>
            <p className="m-0 mt-0.5 text-[12.5px] leading-snug text-muted">{x.hint}</p>
          </div>
          <button type="button" role="switch" aria-checked={f[x.key]} aria-label={x.label} disabled={q.isLoading || save.isPending} onClick={() => save.mutate({ key: x.key, on: !f[x.key] })}
            className={cn("relative mt-1 h-6 w-[42px] shrink-0 rounded-full border transition-colors disabled:opacity-50", f[x.key] ? "border-accent bg-[var(--chip-on)]" : "border-border bg-surface-2")}>
            <i className={cn("absolute top-0.5 h-[18px] w-[18px] rounded-full transition-[left]", f[x.key] ? "left-5 bg-accent" : "left-0.5 bg-muted")} />
          </button>
        </div>
      ))}
      {(q.error || save.error) && <ErrorBanner message={errorMessage(q.error ?? save.error)} onRetry={() => q.refetch()} />}
    </Card>
  );
}
