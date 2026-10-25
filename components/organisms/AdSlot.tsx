"use client";

import Link from "next/link";
import { Button } from "@/components/atoms/Button";
import { useEffect, useRef } from "react";
import { useCredits, useT } from "@/hooks/useApi";
import { api } from "@/lib/api";
import { useSafeQuery as useQuery } from "@/lib/useSafeQuery";

declare global { interface Window { adsbygoogle?: unknown[] } }

/** An ad for the plans that show ads (Free by default): Google AdSense when the administrator set it up, otherwise the
 * app's own card for Editor and Pro. Nothing for paid plans, or where credits are not counted (a private studio). */
export function AdSlot({ place }: { place: "home" | "reels" }) {
  const credits = useCredits(), t = useT();
  const plans = useQuery({ queryKey: ["plans"], queryFn: api.plans, staleTime: 300_000 });
  const ads = useQuery({ queryKey: ["ads"], queryFn: api.ads, staleTime: 300_000 });
  const c = credits.data, plan = c && c.enabled ? plans.data?.plans.find((p) => p.id === c.plan) : undefined;
  const show = !!c && c.enabled && !!plan && (plan.ads ?? plan.id === "free") && ads.data?.enabled !== false;
  const adsense = show && !!ads.data?.client && !!ads.data?.slot;
  const ins = useRef<HTMLModElement>(null);
  useEffect(() => {
    if (!adsense || !ads.data) return;
    const id = "adsbygoogle-js";
    if (!document.getElementById(id)) {
      const s = document.createElement("script"); s.id = id; s.async = true; s.crossOrigin = "anonymous";
      s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ads.data.client)}`; document.head.append(s);
    }
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* blocked by an ad blocker: nothing shows */ }
  }, [adsense, ads.data]);
  if (!show) return null;
  if (adsense) return (
    <aside aria-label="Advertisement" className="overflow-hidden rounded-2xl border border-border bg-surface p-2">
      <p className="m-0 mb-1 text-[10.5px] uppercase tracking-wide text-muted">{t("plan.adLabel")} · <Link href="/pricing" className="underline">{t("plan.removeAds")}</Link></p>
      <ins ref={ins} className="adsbygoogle block" style={{ display: "block" }} data-ad-client={ads.data!.client} data-ad-slot={ads.data!.slot} data-ad-format="auto" data-full-width-responsive="true" data-ad-place={place} />
    </aside>
  );
  return (
    <aside aria-label="Shubix AI" className="flex flex-col items-start gap-2 rounded-2xl border border-border bg-[linear-gradient(120deg,color-mix(in_srgb,var(--accent)_16%,var(--surface)),var(--surface))] p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="m-0 text-[15px] font-bold">{t("plan.aiAdTitle")}</p>
        <p className="m-0 text-[13px] text-muted">{t("plan.aiAdText", { price: `₹${plans.data?.plans.find((p) => p.id !== "free" && !p.hidden)?.monthly ?? 199}` })}</p>
      </div>
      <Button href="/pricing" size="sm" variant="secondary">{t("plan.aiAdButton")}</Button>
    </aside>
  );
}
