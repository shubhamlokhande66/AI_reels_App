"use client";

import { Badge } from "@/components/atoms";
import { LockBadge } from "@/components/molecules/LockBadge";
import { usePlanNeed, useText } from "@/hooks/useApi";
import { cn } from "@/lib/cn";
import { templateHref, templateMeta, templateTag, type StudioTemplate } from "@shubix/core/lib/studio-templates";
import { paintCss, posterShade, templateArt, templateArtFallback } from "@shubix/ui-web";

/** A Fast Studio template: a 9:16 poster with its name and length; opens Fast Studio with it picked. `link={false}`:
 * only the poster and its words (the admin's preview). */
export function TemplateCard({ t, compact = false, link = true }: { t: StudioTemplate; compact?: boolean; link?: boolean }) {
  const words = t.name.replace("/", " ").split(/\s+/).filter(Boolean);
  // a template of a higher plan (Admin → Templates): the Upgrade tag, and a tap opens the plans
  const text = useText(), need = usePlanNeed(), locked = link && !!need && need(t.plan);
  const Tag = link ? "a" : "div";
  return (
    <Tag {...(link ? { href: locked ? `/pricing?need=${encodeURIComponent(`template:${t.id}`)}` : templateHref(t), title: locked ? `${t.name}: in a paid plan` : `Make a Reel with ${t.name}` } : {})} className="group flex min-w-0 flex-col gap-2 rounded-[20px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background">
      <div className={cn("relative aspect-[9/16] w-full overflow-hidden rounded-[20px] [container-type:inline-size] border border-white/12 shadow-[0_14px_34px_-24px_rgba(0,0,0,.78)] transition-[transform,border-color,box-shadow] duration-300 group-hover:-translate-y-1 group-hover:border-accent/35 group-hover:shadow-[0_24px_44px_-26px_rgba(0,0,0,.8)] group-active:scale-[.99]")} style={{ background: paintCss(templateArt[t.id] ?? templateArtFallback) }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a small static cover */}
        {t.cover && <img src={t.cover} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />}
        <span className="absolute inset-0 transition-opacity duration-300 group-hover:opacity-90" style={{ background: paintCss(posterShade) }} />
        <span aria-hidden className="pointer-events-none absolute -right-[18%] top-[18%] h-[44%] w-[70%] rounded-full border border-white/15 bg-white/10 opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100" />
        <span className="absolute inset-x-3 bottom-10 -rotate-3 font-[family-name:var(--font-display)] text-[clamp(15px,5.2cqw+8px,24px)] font-extrabold uppercase leading-[0.95] text-white [text-shadow:0_2px_0_rgba(0,0,0,.45),0_6px_16px_rgba(0,0,0,.4)] transition-transform duration-300 group-hover:-rotate-1 group-hover:translate-y-[-2px]">
          {words.map((w) => (
            <span key={w} className="block">
              {w}
            </span>
          ))}
        </span>
        {locked ? <span className="absolute left-2.5 top-2.5"><LockBadge card /></span> : t.isNew && <Badge tone="dark" className="absolute left-2.5 top-2.5">{text("templates.newTag")}</Badge>}
        <Badge tone="dark" className="absolute bottom-2.5 right-2.5">
          {templateTag(t, text)}
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
