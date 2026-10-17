"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Toggle } from "@/components/atoms";
import { ErrorBanner } from "@/components/molecules";
import { api, errorMessage } from "@/lib/api";
import { DEFAULTS, FEATURE_LIST, type FeatureKey } from "@/lib/features-list";

/** Administration → Features: show or hide each part of the app for everyone. A hidden part leaves the menus and the
 * dashboard, its page says it is off, and the server refuses its work (for anyone but the administrator). */
export function FeatureSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["features"], queryFn: api.features });
  const save = useMutation({
    mutationFn: (p: { key: FeatureKey; on: boolean }) => api.setFeatures({ [p.key]: p.on }),
    onSuccess: (f) => qc.setQueryData(["features"], f),
  });
  const f = q.data ?? DEFAULTS;
  const serverOn = FEATURE_LIST.filter((x) => x.server && f[x.key]).length;
  return (
    <section className="card" aria-label="Features">
      <div className="between">
        <span className="h2">Features</span>
        <span className="mu xs">{serverOn} using the server</span>
      </div>
      <span className="mu sm">Choose what people see. A hidden part disappears from the menu and the dashboard, and the server stops doing its work.</span>
      {FEATURE_LIST.map((x) => (
        <div key={x.key} className="flex flex-col gap-1 border-t border-border pt-2.5">
          <Toggle
            label={x.label}
            hint={x.hint}
            on={f[x.key]}
            disabled={q.isLoading || save.isPending}
            onChange={(on) => save.mutate({ key: x.key, on })}
          />
          <span className={`badge self-start ${x.server ? "b-run" : "b-ok"}`}>{x.server ? "Uses the server" : "Runs on the phone"}</span>
        </div>
      ))}
      {!f.aiReel && !f.productReel && <span className="xs" style={{ color: "var(--warning)" }}>Create Reel is hidden: both of its kinds are off.</span>}
      {(q.error || save.error) && <ErrorBanner message={errorMessage(q.error ?? save.error)} onRetry={() => q.refetch()} />}
    </section>
  );
}
