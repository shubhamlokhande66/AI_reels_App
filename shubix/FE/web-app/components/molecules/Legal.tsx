"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useState } from "react";
import { useSafeQuery as useQuery } from "@/lib/useSafeQuery";
import { api } from "@/lib/api";
import type { SiteInfo } from "@/types/api";
import { cn } from "@/lib/cn";
import { useT } from "@/hooks/useApi";
import { Card } from "@/components/atoms/Card";
import { chipClass, ChipRow } from "@/components/atoms/Chip";
import { Logo } from "@/components/atoms/Logo";
import { RichText } from "./RichText";

// the legal links: their names are texts (Admin → CMS → Legal pages)
export const LEGAL_LINKS = [
  ["/terms", "legal.terms"],
  ["/privacy", "legal.privacy"],
  ["/refunds", "legal.refunds"],
  ["/contact", "legal.contact"],
] as const;

export function useSite() {
  return useQuery({ queryKey: ["site"], queryFn: api.site, staleTime: 3_600_000 });
}

/** The business details. What the administrator has not filled in yet is left out for people (never a placeholder on
 * screen); `reach` is how to reach us in a sentence: the email, else the Contact page. The administrator page lists
 * what is missing (Admin → Settings → Business details). */
export function siteOr(site: SiteInfo | undefined) {
  const email = site?.supportEmail || "";
  return {
    name: site?.businessName || "Shubix",
    email,
    phone: site?.supportPhone || "",
    address: site?.businessAddress || "",
    reach: email || "us from the Contact page",
    updated: site?.legalUpdated || "",
  };
}

export function LegalFooter({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  const t = useT();
  if (compact) {
    return (
      <nav aria-label="Legal" className={cn("flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted", className)}>
        {[...LEGAL_LINKS, ["/pricing", "legal.pricing"] as const].map(([href, key]) => (
          <Link key={href} href={href} className="inline-block rounded-sm py-1.5 transition-colors duration-200 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
            {t(key)}
          </Link>
        ))}
      </nav>
    );
  }
  return (
    <footer className={cn("relative overflow-hidden px-4 sm:px-6", className)}>
      <div className="pointer-events-none absolute -right-10 -top-16 h-36 w-36 rounded-full bg-accent/5 blur-3xl" />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <Link href="/" aria-label="Shubix home" className="w-fit rounded-lg transition-opacity duration-200 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
          <Logo height={72} />
        </Link>
        <nav aria-label="Legal" className="flex flex-wrap items-center gap-x-4 gap-y-1.5 sm:justify-end">
          {[...LEGAL_LINKS, ["/pricing", "legal.pricing"] as const].map(([href, key]) => (
            <Link key={href} href={href} className="rounded-sm py-1 text-[11px] font-medium text-muted transition-colors duration-200 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
              {t(key)}
            </Link>
          ))}
        </nav>
      </div>
      <div className="relative mt-4 flex flex-col gap-1 border-t border-[color-mix(in_srgb,var(--accent)_12%,var(--line))] pt-3 text-[10px] text-muted/80 sm:flex-row sm:items-center sm:justify-between">
        <span>© {new Date().getFullYear()} Shubix Studio</span>
        <span className="tracking-[.08em]">REELS VIDEO STUDIO</span>
      </div>
    </footer>
  );
}

const PAGES = { terms: ["/terms", "legal.termsTitle", "legal.termsBody"], privacy: ["/privacy", "legal.privacyTitle", "legal.privacyBody"], refunds: ["/refunds", "legal.refundsTitle", "legal.refundsBody"] } as const;
export type LegalPageId = keyof typeof PAGES;

/** A readable legal page (design: "Legal"): the three legal pages as chips, the title and date, a list of the sections
 * (tap to jump), then the text, which the administrator writes (Admin → CMS → Legal pages). */
export function LegalPage({ page }: { page: LegalPageId }) {
  const t = useT();
  const s = siteOr(useSite().data);
  const pathname = usePathname();
  const [toc, setToc] = useState<{ id: string; text: string }[]>([]);
  const body = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const heads = Array.from(el.querySelectorAll("h2")).map((h, i) => {
      if (!h.id) h.id = `s${i + 1}`;
      return { id: h.id, text: h.textContent ?? "" };
    });
    setToc((cur) => (cur.length === heads.length && cur.every((c, i) => c.text === heads[i].text) ? cur : heads));
  }, []);
  const [, title, text] = PAGES[page];
  const vars = { name: s.name, reach: s.reach, contact: `${s.email || t("legal.writeUs")}${s.phone ? `, ${s.phone}` : ""}`, business: `${s.name}${s.address ? `, ${s.address}` : ""}` };
  return (
    <article className="relative mx-auto flex w-full max-w-4xl flex-col gap-5 pb-4 md:gap-7">
      <div aria-hidden className="pointer-events-none absolute -top-12 left-1/2 -z-10 h-56 w-[min(90vw,48rem)] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,color-mix(in_srgb,var(--accent)_14%,transparent),transparent_68%)] blur-2xl" />
      <ChipRow aria-label={t("legal.terms")} wrap className="rounded-2xl border border-[color-mix(in_srgb,var(--accent)_12%,var(--line))] bg-[color-mix(in_srgb,var(--surface)_54%,transparent)] p-2 shadow-[0_10px_30px_-28px_rgba(0,0,0,.8)] backdrop-blur-xl">
        {Object.values(PAGES).map(([href]) => {
          const key = LEGAL_LINKS.find(([h]) => h === href)![1];
          return (
            <Link key={href} href={href} aria-current={href === pathname ? "page" : undefined} className={chipClass(href === pathname, "!h-9 !px-4 !text-[11.5px] !transition-all !duration-200") }>
              {t(key)}
            </Link>
          );
        })}
      </ChipRow>
      <header className="relative overflow-hidden rounded-[24px] border border-[color-mix(in_srgb,var(--accent)_18%,var(--line))] bg-[linear-gradient(125deg,color-mix(in_srgb,var(--accent)_10%,var(--surface)),var(--surface)_56%,color-mix(in_srgb,var(--accent)_4%,var(--surface)))] px-5 py-6 shadow-[0_20px_50px_-38px_rgba(0,0,0,.82)] sm:px-8 sm:py-8">
        <span aria-hidden className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full border border-accent/10 bg-accent/5 blur-2xl" />
        <div className="relative flex flex-col gap-3">
          <span className="flex items-center gap-2 text-[9px] font-extrabold uppercase tracking-[.2em] text-accent"><span className="h-px w-5 bg-accent/70" />Shubix · Legal</span>
          <h1 className="m-0 font-[family-name:var(--font-display)] text-[clamp(28px,5vw,42px)] font-semibold leading-[1.08] tracking-[-0.03em]">{t(title)}</h1>
          {s.updated && <span className="text-[11.5px] text-muted">{t("legal.updated", { date: s.updated })}</span>}
        </div>
      </header>
      {toc.length > 1 && (
        <Card as="nav" aria-label={t("legal.sections")} className="!rounded-[20px] !border-[color-mix(in_srgb,var(--accent)_14%,var(--line))] !bg-[color-mix(in_srgb,var(--surface)_76%,transparent)] !p-4 md:!p-5">
          <div className="mb-3 flex items-center gap-2 text-[9px] font-extrabold uppercase tracking-[.18em] text-muted"><span className="h-1.5 w-1.5 rounded-full bg-accent" />{t("legal.sections")}</div>
          <div className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
            {toc.map((x, i) => (
              <a key={x.id} href={`#${x.id}`} className="group flex min-w-0 items-center gap-2 border-t border-border/70 py-2.5 text-[12px] font-semibold text-muted transition-colors duration-200 hover:text-foreground">
                <span className="font-mono text-[9px] text-accent/80">{String(i + 1).padStart(2, "0")}</span>
                <span className="truncate">{x.text}</span>
                <span className="ml-auto text-accent opacity-0 transition-opacity group-hover:opacity-100">↗</span>
              </a>
            ))}
          </div>
        </Card>
      )}
      <Card as="section" aria-label={t(title)} className="!rounded-[22px] !border-[color-mix(in_srgb,var(--accent)_12%,var(--line))] !p-5 sm:!p-7 md:!p-9">
        <div ref={body} className="flex flex-col gap-4 text-[14px] leading-[1.8] text-muted [&>h2]:mt-3 [&>h2]:scroll-mt-24 [&>h2]:border-b [&>h2]:border-[color-mix(in_srgb,var(--accent)_14%,var(--line))] [&>h2]:pb-2.5 [&>h2]:font-[family-name:var(--font-display)] [&>h2]:text-[18px] [&>h2]:font-semibold [&>h2]:tracking-[-.01em] [&>h2]:text-foreground [&>p]:leading-[1.85] [&>ul]:space-y-2 [&>ul]:marker:text-accent [&_strong]:font-semibold [&_strong]:text-foreground">
          <RichText text={t(text, vars)} />
        </div>
      </Card>
    </article>
  );
}
