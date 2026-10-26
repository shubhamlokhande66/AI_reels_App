"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/hooks/useApi";
import { Icon } from "@/components/atoms";
import { cn } from "@/lib/cn";
import type { Offer } from "@/lib/marketing";

/** "Ends in 2 days" / "ends in 5 h" / "ends today": the time left of a sale. */
function left(ends: string | null) {
  if (!ends) return "";
  const ms = new Date(ends).getTime() - Date.now();
  if (ms <= 0) return "";
  const h = Math.floor(ms / 3600_000), d = Math.floor(h / 24);
  return d >= 1 ? `in ${d} day${d > 1 ? "s" : ""}` : h >= 1 ? `in ${h} h` : "soon";
}

/** A sale running (Admin → Marketing → Offers): its name, its line, how much off and when it ends. On the pricing page as
 * a band; across the app (`bar`) a slim line with a link to the plans, closed for that sale with ✕. */
export function OfferStrip({ offer, bar = false }: { offer: Offer; bar?: boolean }) {
  const t = useT(), key = `shubix-offer-${offer.id}`;
  const [hidden, setHidden] = useState(false);
  useEffect(() => { void Promise.resolve().then(() => { try { if (bar && localStorage.getItem(key)) setHidden(true); } catch { /* shown */ } }); }, [bar, key]);
  if (hidden) return null;
  const when = left(offer.ends);
  const text = (
    <>
      <b className="font-semibold">{offer.title}</b>
      <span className="text-[color-mix(in_srgb,currentColor_80%,transparent)]">{offer.banner ? ` · ${offer.banner}` : ""}{offer.audience === "new" ? ` · ${t("pricing.offerNew")}` : ""}{when ? ` · ${t("pricing.offerEnds", { when })}` : ""}</span>
    </>
  );
  if (bar)
    return (
      <div role="note" className="mb-3 flex items-center gap-2.5 rounded-2xl border border-accent/30 bg-[linear-gradient(90deg,color-mix(in_srgb,var(--accent)_14%,var(--surface)),var(--surface))] px-3.5 py-2 text-[12.5px]">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[image:var(--gold-gradient)] text-white"><Icon name="sparkle" size={14} /></span>
        <span className="min-w-0 flex-1 truncate">{text}</span>
        <span className="hidden shrink-0 rounded-full bg-[image:var(--gold-gradient)] px-2 py-0.5 text-[11px] font-bold text-white sm:inline">{t("pricing.offerTag", { percent: offer.percent })}</span>
        <Link href="/pricing" className="shrink-0 font-semibold text-accent hover:underline">{t("pricing.offerSee")}</Link>
        <button type="button" aria-label="Close" onClick={() => { setHidden(true); try { localStorage.setItem(key, "1"); } catch { /* closed for now */ } }} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-foreground"><Icon name="close" size={14} /></button>
      </div>
    );
  return (
    <div role="note" className={cn("mx-auto -mt-4 flex w-full max-w-3xl flex-wrap items-center justify-center gap-x-3 gap-y-1.5 rounded-2xl border border-accent/30 px-4 py-3 text-center text-[13.5px]",
      "bg-[linear-gradient(90deg,color-mix(in_srgb,var(--accent)_12%,var(--surface)),color-mix(in_srgb,#e040fb_10%,var(--surface)))] shadow-[var(--shadow)]")}>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[image:var(--gold-gradient)] px-2.5 py-0.5 text-[11.5px] font-bold text-white"><Icon name="sparkle" size={12} />{t("pricing.offerTag", { percent: offer.percent })}</span>
      <span>{text}</span>
    </div>
  );
}
