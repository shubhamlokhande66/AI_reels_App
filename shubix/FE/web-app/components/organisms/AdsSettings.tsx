"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage, type AdPlace, type AdsConfig } from "@/lib/api";

const SPOTS: [AdPlace, string][] = [["home", "Home: under Create"], ["homeEnd", "Home: lower down"], ["reels", "My Reels"], ["rewards", "Invite & earn"], ["account", "My account"]];
import { btnPrimary, Card } from "@/components/atoms";
import { ErrorBanner } from "@/components/molecules";

/** Admin: ads for the plans that show them (Plans & pricing → Ads): on or off, the Google AdSense ids (website) and the
 * AdMob banner ad units (phone app). Without ids, the app shows its own card for the paid plans in the same place. */
export function AdsSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ads"], queryFn: api.ads });
  const [f, setF] = useState<AdsConfig | null>(null);
  const cur = f ?? q.data ?? null;
  const save = useMutation({ meta: { success: "Saved", errorShown: true }, mutationFn: api.setAds, onSuccess: (d) => { qc.setQueryData(["ads"], d); setF(null); } });
  if (!cur) return null;
  const IN = "w-full rounded-xl border border-border bg-surface px-2.5 py-1.5 outline-none focus:border-accent";
  return (
    <Card className="max-w-2xl space-y-4">
      <div>
        <h2 className="font-medium">Ads</h2>
        <p className="mt-1 text-sm text-muted">Shown in the spots below to the plans with &quot;Ads&quot; ticked in Plans &amp; pricing (Free). Never in the editor. Website: Google AdSense; phone app: Google AdMob. Without ids, the app shows its own card there (Shubix AI on Editor and Pro, or invite friends).</p>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cur.enabled} onChange={(e) => setF({ ...cur, enabled: e.target.checked })} /> Show ads</label>
      <fieldset className="grid gap-1.5 text-sm" disabled={!cur.enabled}>
        <legend className="mb-1 text-muted">Where ({SPOTS.filter(([k]) => cur.places?.[k] !== false).length} of {SPOTS.length} spots)</legend>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {SPOTS.map(([k, name]) => (
            <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={cur.places?.[k] !== false} onChange={(e) => setF({ ...cur, places: { ...cur.places, [k]: e.target.checked } })} /> {name}</label>
          ))}
        </div>
      </fieldset>
      <label className="grid gap-1 text-sm"><span className="text-muted">AdSense publisher id</span><input className={IN} placeholder="ca-pub-1234567890123456" value={cur.client} onChange={(e) => setF({ ...cur, client: e.target.value })} /></label>
      <label className="grid gap-1 text-sm"><span className="text-muted">Ad slot (AdSense → Ads → By ad unit)</span><input className={IN} placeholder="1234567890" value={cur.slot} onChange={(e) => setF({ ...cur, slot: e.target.value })} /></label>
      <p className="text-sm font-medium">Phone app (Google AdMob)</p>
      <label className="grid gap-1 text-sm"><span className="text-muted">Android banner ad unit (AdMob → Apps → Ad units)</span><input className={IN} placeholder="ca-app-pub-1234567890123456/1234567890" value={cur.admob?.android ?? ""} onChange={(e) => setF({ ...cur, admob: { ...cur.admob, android: e.target.value } })} /></label>
      <label className="grid gap-1 text-sm"><span className="text-muted">iPhone banner ad unit</span><input className={IN} placeholder="ca-app-pub-1234567890123456/1234567890" value={cur.admob?.ios ?? ""} onChange={(e) => setF({ ...cur, admob: { ...cur.admob, ios: e.target.value } })} /></label>
      <label className="grid gap-1 text-sm"><span className="text-muted">Android full-screen ad unit (after an export)</span><input className={IN} placeholder="ca-app-pub-1234567890123456/1234567890" value={cur.admob?.interstitial ?? ""} onChange={(e) => setF({ ...cur, admob: { ...cur.admob, interstitial: e.target.value } })} /></label>
      <label className="grid gap-1 text-sm"><span className="text-muted">Android rewarded ad unit (watch an ad, get credits)</span><input className={IN} placeholder="ca-app-pub-1234567890123456/1234567890" value={cur.admob?.rewarded ?? ""} onChange={(e) => setF({ ...cur, admob: { ...cur.admob, rewarded: e.target.value } })} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm"><span className="text-muted">Credits for one rewarded ad</span><input className={IN} type="number" min={0} max={100} value={cur.admob?.rewardCredits ?? 0} onChange={(e) => setF({ ...cur, admob: { ...cur.admob, rewardCredits: Number(e.target.value) } })} /></label>
        <label className="grid gap-1 text-sm"><span className="text-muted">Rewarded ads a day, per person</span><input className={IN} type="number" min={0} max={100} value={cur.admob?.rewardDaily ?? 0} onChange={(e) => setF({ ...cur, admob: { ...cur.admob, rewardDaily: Number(e.target.value) } })} /></label>
      </div>
      <p className="text-xs text-muted">The AdMob app id is built into the app (ADMOB_ANDROID_APP_ID / ADMOB_IOS_APP_ID when it is built). /app-ads.txt follows these ids.</p>
      {save.error && <ErrorBanner message={errorMessage(save.error)} />}
      {save.isSuccess && !f && <p className="text-sm text-success">✓ Saved.</p>}
      <button type="button" className={btnPrimary} disabled={save.isPending || !f} onClick={() => f && save.mutate(f)}>{save.isPending ? "Saving…" : "Save ads"}</button>
    </Card>
  );
}
