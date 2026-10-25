"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { btnPrimary, Card } from "@/components/atoms";
import { ErrorBanner } from "@/components/molecules";

/** Admin: ads for the plans that show them (Plans & pricing → Ads): on or off, and the Google AdSense ids. Without
 * AdSense ids the app shows its own card for the paid plans in the same place (Home, My Reels). */
export function AdsSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ads"], queryFn: api.ads });
  const [f, setF] = useState<{ enabled: boolean; client: string; slot: string } | null>(null);
  const cur = f ?? q.data ?? null;
  const save = useMutation({ mutationFn: api.setAds, onSuccess: (d) => { qc.setQueryData(["ads"], d); setF(null); } });
  if (!cur) return null;
  const IN = "w-full rounded-xl border border-border bg-surface px-2.5 py-1.5 outline-none focus:border-accent";
  return (
    <Card className="max-w-2xl space-y-4">
      <div>
        <h2 className="font-medium">Ads</h2>
        <p className="mt-1 text-sm text-muted">Shown on Home and My Reels to the plans with &quot;Ads&quot; ticked in Plans &amp; pricing (Free). Never in the editor. Without AdSense ids, the app shows its own card for Editor and Pro there.</p>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cur.enabled} onChange={(e) => setF({ ...cur, enabled: e.target.checked })} /> Show ads</label>
      <label className="grid gap-1 text-sm"><span className="text-muted">AdSense publisher id</span><input className={IN} placeholder="ca-pub-1234567890123456" value={cur.client} onChange={(e) => setF({ ...cur, client: e.target.value })} /></label>
      <label className="grid gap-1 text-sm"><span className="text-muted">Ad slot (AdSense → Ads → By ad unit)</span><input className={IN} placeholder="1234567890" value={cur.slot} onChange={(e) => setF({ ...cur, slot: e.target.value })} /></label>
      {save.error && <ErrorBanner message={errorMessage(save.error)} />}
      {save.isSuccess && !f && <p className="text-sm text-success">✓ Saved.</p>}
      <button type="button" className={btnPrimary} disabled={save.isPending || !f} onClick={() => f && save.mutate(f)}>{save.isPending ? "Saving…" : "Save ads"}</button>
    </Card>
  );
}
