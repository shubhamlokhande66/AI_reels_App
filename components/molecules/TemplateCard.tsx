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
const ART_MORE: Record<string, string> = {
  cardelivery: "bg-[radial-gradient(circle_at_50%_70%,rgba(255,60,60,.7),transparent_35%),linear-gradient(160deg,#2b2b2b,#0d0d0d_60%,#000)]",
  opening: "bg-[radial-gradient(circle_at_50%_30%,rgba(255,215,90,.8),transparent_35%),linear-gradient(160deg,#d4a017,#7a1f1f_60%,#1c0707)]",
  party: "bg-[radial-gradient(circle_at_30%_30%,rgba(120,80,255,.8),transparent_35%),radial-gradient(circle_at_75%_60%,rgba(255,60,200,.6),transparent_30%),linear-gradient(160deg,#120a2e,#05030f)]",
};
Object.assign(ART, ART_MORE);
const FALLBACK = "bg-[radial-gradient(circle_at_60%_30%,rgba(200,140,255,.6),transparent_38%),linear-gradient(160deg,#7c3aed,#2a1660_60%,#0b0b22)]";

/** A Fast Studio template: a 9:16 poster with its name and length; opens Fast Studio with it picked. `link={false}`:
 * only the poster and its words (the admin's preview). */
export function TemplateCard({ t, compact = false, link = true }: { t: StudioTemplate; compact?: boolean; link?: boolean }) {
  const words = t.name.replace("/", " ").split(/\s+/).filter(Boolean);
  // a template of a higher plan (Admin → Templates): the Upgrade tag, and a tap opens the plans
  const need = usePlanNeed(), locked = link && !!need && need(t.plan);
  const Tag = link ? "a" : "div";
  return (
    <Tag {...(link ? { href: locked ? `/pricing?need=${encodeURIComponent(`template:${t.id}`)}` : templateHref(t), title: locked ? `${t.name}: in a paid plan` : `Make a Reel with ${t.name}` } : {})} className="group flex min-w-0 flex-col gap-1.5">
      <div className={cn("relative aspect-[9/16] w-full overflow-hidden rounded-2xl [container-type:inline-size] border border-white/10 transition-transform duration-300 group-hover:-translate-y-1", ART[t.id] ?? FALLBACK)}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a small static cover */}
        {t.cover && <img src={t.cover} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />}
        <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
        <span className="absolute inset-x-2.5 bottom-9 -rotate-6 font-[family-name:var(--font-display)] text-[clamp(15px,5.2cqw+8px,24px)] font-extrabold uppercase leading-[0.95] text-white [text-shadow:0_2px_0_rgba(0,0,0,.45),0_6px_16px_rgba(0,0,0,.4)]">
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
          <b className="truncate text-[13px] group-hover:text-accent">{t.name}</b>
          <span className="text-[11px] text-muted">{templateMeta(t)}</span>
          <span className="line-clamp-2 text-[11px] leading-snug text-muted">{t.text}</span>
        </>
      )}
    </Tag>
  );
}
