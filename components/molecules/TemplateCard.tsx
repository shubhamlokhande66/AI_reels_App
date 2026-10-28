"use client";

import { Badge } from "@/components/atoms";
import { LockBadge } from "@/components/molecules/LockBadge";
import { usePlanNeed } from "@/hooks/useApi";
import { cn } from "@/lib/cn";
import { templateHref, templateMeta, type StudioTemplate } from "@/lib/studio-templates";

/** Each template's poster art (UI/ design: Popular Templates): glowing light over its own colours, until a cover
 * picture is set (the administrator's cover address, Admin → Templates). */
const ART: Record<string, string> = {
  montage: "bg-[radial-gradient(circle_at_70%_25%,rgba(255,120,240,.75),transparent_40%),linear-gradient(160deg,#ff3fd0,#6d28d9_55%,#1a0b3d)]",
  beforeafter: "bg-[radial-gradient(circle_at_40%_30%,rgba(255,220,190,.6),transparent_38%),linear-gradient(160deg,#c08a6a,#5b3b2e_60%,#1e1412)]",
  talking: "bg-[radial-gradient(circle_at_50%_35%,rgba(255,200,160,.55),transparent_35%),linear-gradient(160deg,#ff7a59,#7c2d92_60%,#1a0b3d)]",
  tutorial: "bg-[radial-gradient(circle_at_60%_30%,rgba(140,200,255,.6),transparent_38%),linear-gradient(160deg,#3b8bff,#1d3a8a_60%,#0b1030)]",
  product: "bg-[radial-gradient(circle_at_55%_40%,rgba(255,200,120,.8),transparent_35%),linear-gradient(160deg,#b8742f,#4a2a12_60%,#150b05)]",
  recipe: "bg-[radial-gradient(circle_at_50%_55%,rgba(255,170,80,.85),transparent_40%),linear-gradient(160deg,#e0782f,#7a2e12_60%,#1f0c06)]",
  travel: "bg-[radial-gradient(circle_at_50%_20%,rgba(255,255,255,.65),transparent_30%),linear-gradient(180deg,#5fb6ff,#2a6fb0_45%,#2f7a6a_70%,#123a2e)]",
  ganpati: "bg-[radial-gradient(circle_at_60%_35%,rgba(255,190,90,.85),transparent_38%),linear-gradient(160deg,#ff7a1a,#b0201f_55%,#2a0606)]",
  diwali: "bg-[radial-gradient(circle_at_40%_40%,rgba(255,210,110,.85),transparent_30%),radial-gradient(circle_at_75%_70%,rgba(255,120,60,.6),transparent_28%),linear-gradient(160deg,#4a1d6b,#1a0b3d)]",
};
const FALLBACK = "bg-[radial-gradient(circle_at_60%_30%,rgba(216,189,123,.45),transparent_38%),linear-gradient(160deg,#70603c,#332c20_60%,#151411)]";

/** A Fast Studio template: a 9:16 poster with its name and length; opens Fast Studio with it picked. `link={false}`:
 * only the poster and its words (the admin's preview). */
export function TemplateCard({ t, compact = false, link = true }: { t: StudioTemplate; compact?: boolean; link?: boolean }) {
  const words = t.name.replace("/", " ").split(/\s+/).filter(Boolean);
  // a template of a higher plan (Admin → Templates): the Upgrade tag, and a tap opens the plans
  const need = usePlanNeed(), locked = link && !!need && need(t.plan);
  const Tag = link ? "a" : "div";
  return (
    <Tag {...(link ? { href: locked ? `/pricing?need=${encodeURIComponent(`template:${t.id}`)}` : templateHref(t), title: locked ? `${t.name}: in a paid plan` : `Make a Reel with ${t.name}` } : {})} className="group flex min-w-0 flex-col gap-2 rounded-[20px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background">
      <div className={cn("relative aspect-[9/16] w-full overflow-hidden rounded-[20px] [container-type:inline-size] border border-white/12 shadow-[0_14px_34px_-24px_rgba(0,0,0,.78)] transition-[transform,border-color,box-shadow] duration-300 group-hover:-translate-y-1 group-hover:border-accent/35 group-hover:shadow-[0_24px_44px_-26px_rgba(0,0,0,.8)] group-active:scale-[.99]", ART[t.id] ?? FALLBACK)}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a small static cover */}
        {t.cover && <img src={t.cover} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />}
        <span className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,.06)_8%,transparent_38%,rgba(0,0,0,.14)_58%,rgba(0,0,0,.78)_100%)] transition-opacity duration-300 group-hover:opacity-90" />
        <span aria-hidden className="pointer-events-none absolute -right-[18%] top-[18%] h-[44%] w-[70%] rounded-full border border-white/15 bg-white/10 opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100" />
        <span className="absolute inset-x-3 bottom-10 -rotate-3 font-[family-name:var(--font-display)] text-[clamp(15px,5.2cqw+8px,24px)] font-extrabold uppercase leading-[0.95] text-white [text-shadow:0_2px_0_rgba(0,0,0,.45),0_6px_16px_rgba(0,0,0,.4)] transition-transform duration-300 group-hover:-rotate-1 group-hover:translate-y-[-2px]">
          {words.map((w) => (
            <span key={w} className="block">
              {w}
            </span>
          ))}
        </span>
        {locked ? <span className="absolute left-2.5 top-2.5"><LockBadge card /></span> : t.isNew && <Badge tone="dark" className="absolute left-2.5 top-2.5">✨ New</Badge>}
        <Badge tone="dark" className="absolute bottom-2.5 right-2.5">
          {t.kind === "talk" ? "Talk" : t.kind === "photo" ? `Photos${t.len ? ` · ${t.len}s` : ""}` : t.len ? `${t.len}s` : "Music"}
        </Badge>
      </div>
      {!compact && (
        <>
          <b className="truncate text-[12px] font-bold leading-tight transition-colors duration-200 group-hover:text-accent sm:text-[13px]">{t.name}</b>
          <span className="truncate text-[10px] font-medium text-muted sm:text-[11px]">{templateMeta(t)}</span>
          <span className="line-clamp-2 min-h-[2.5em] text-[10px] leading-[1.35] text-muted sm:text-[11px]">{t.text}</span>
        </>
      )}
    </Tag>
  );
}
