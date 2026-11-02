"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { Card } from "@/components/atoms";
import { ErrorBanner } from "@/components/molecules";
import { ago } from "./format";

/** What broke in people's browsers (last 30 days): the same error once, with how often, where and on which device.
 * "Fixed" removes it; if it comes back, it shows again. */
const KIND: Record<string, string> = { error: "Error", rejection: "Error (async)", studio: "Studio did not start", webgl: "WebGL off (slower renderer)", clip: "A clip could not be read", audio: "Sound did not start (Play)", crash: "Phone reloaded the studio (memory)", perf: "Clip reading speed" };
export function ErrorsTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-errors"], queryFn: api.adminErrors, refetchInterval: 60_000 });
  const fix = useMutation({ meta: { success: "Marked as fixed" }, mutationFn: api.clearAdminError, onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-errors"] }) });
  if (q.error) return <ErrorBanner message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const rows = q.data?.errors ?? [];
  return (
    <div className="flex flex-col gap-3">
      <Card><p className="m-0 text-sm">{q.isLoading ? "Loading…" : rows.length ? `${rows.length} different errors in the last 30 days, ${rows.reduce((n, r) => n + r.count, 0)} times in all.` : "No errors reported in the last 30 days."}</p></Card>
      {rows.map((r) => (
        <Card key={r.id}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="m-0 text-xs text-muted">{KIND[r.kind] ?? r.kind} · {r.count}× · last {ago(r.lastAt)} · {r.path}</p>
              <p className="m-0 break-words font-medium">{r.message}</p>
              {r.where && <p className="m-0 break-all text-xs text-muted">{r.where}</p>}
              <p className="m-0 truncate text-xs text-muted" title={r.ua}>{r.ua}</p>
              {r.stack && <details className="mt-1 text-xs"><summary>Details</summary><pre className="whitespace-pre-wrap break-all">{r.stack}</pre></details>}
            </div>
            <button type="button" className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-bold transition-[filter,border-color,background-color,color] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent border border-border bg-surface text-foreground hover:border-accent/60 h-11 rounded-xl px-4 text-sm mini" disabled={fix.isPending} onClick={() => fix.mutate(r.id)}>Fixed</button>
          </div>
        </Card>
      ))}
    </div>
  );
}
