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

export function LegalFooter({ className = "" }: { className?: string }) {
  const t = useT();
  return (
    <nav aria-label="Legal" className={cn("flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted", className)}>
      {[...LEGAL_LINKS, ["/pricing", "legal.pricing"] as const].map(([href, key]) => (
        <Link key={href} href={href} className="inline-block py-1.5 hover:text-accent">
          {t(key)}
        </Link>
      ))}
    </nav>
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
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      <ChipRow aria-label={t("legal.terms")}>
        {Object.values(PAGES).map(([href]) => {
          const key = LEGAL_LINKS.find(([h]) => h === href)![1];
          return (
            <Link key={href} href={href} aria-current={href === pathname ? "page" : undefined} className={chipClass(href === pathname)}>
              {t(key)}
            </Link>
          );
        })}
      </ChipRow>
      <div>
        <h1 className="m-0 font-[family-name:var(--font-display)] text-[clamp(26px,5vw,34px)] font-semibold leading-[1.12] tracking-[-0.02em]">{t(title)}</h1>
        {s.updated && <span className="text-[12.5px] text-muted">{t("legal.updated", { date: s.updated })}</span>}
      </div>
      {toc.length > 1 && (
        <Card as="section" aria-label={t("legal.sections")} className="flex flex-col px-3.5 py-1.5 md:px-3.5 md:py-1.5">
          {toc.map((x) => (
            <a key={x.id} href={`#${x.id}`} className="border-b border-border py-2.5 text-[12.5px] font-bold last:border-b-0 hover:text-accent">{x.text}</a>
          ))}
        </Card>
      )}
      <div ref={body} className="flex flex-col gap-3 text-[14.5px]">
        <RichText text={t(text, vars)} />
      </div>
    </article>
  );
}
