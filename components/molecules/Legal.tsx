"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useState } from "react";
import { useSafeQuery as useQuery } from "@/lib/useSafeQuery";
import { api } from "@/lib/api";
import type { SiteInfo } from "@/types/api";

export const LEGAL_LINKS = [
  ["/terms", "Terms"],
  ["/privacy", "Privacy"],
  ["/refunds", "Refunds & cancellation"],
  ["/contact", "Contact"],
] as const;

export function useSite() {
  return useQuery({ queryKey: ["site"], queryFn: api.site, staleTime: 3_600_000 });
}

/** The business details. What the administrator has not filled in yet is left out for people (never a placeholder on
 * screen); `reach` is how to reach us in a sentence: the email, else the Contact page. The administrator page lists
 * what is missing (missingSite). */
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
/** the business details still to set on the server (shown to the administrator only) */
export function missingSite(site: SiteInfo | undefined): string[] {
  if (!site) return [];
  return [!site.supportEmail && "SUPPORT_EMAIL (support email)", !site.businessAddress && "BUSINESS_ADDRESS (registered address)", !site.supportPhone && "SUPPORT_PHONE (phone / WhatsApp, optional)"].filter(Boolean) as string[];
}

export function LegalFooter({ className = "" }: { className?: string }) {
  return (
    <nav aria-label="Legal" className={`flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted ${className}`}>
      {LEGAL_LINKS.map(([href, label]) => (
        <Link key={href} href={href} className="inline-block py-1.5 hover:text-accent">
          {label}
        </Link>
      ))}
      <Link href="/pricing" className="inline-block py-1.5 hover:text-accent">
        Pricing
      </Link>
    </nav>
  );
}

const LEGAL_TABS = [
  ["/terms", "Terms"],
  ["/privacy", "Privacy"],
  ["/refunds", "Refunds & cancellation"],
] as const;

/** A readable legal page (design: "Legal"): the three legal pages as chips, the title and date, a list of the sections
 * (tap to jump), then the text. */
export function LegalPage({ title, children }: { title: string; children: (s: ReturnType<typeof siteOr>) => React.ReactNode }) {
  const site = useSite();
  const s = siteOr(site.data);
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
  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      {LEGAL_TABS.some(([h]) => h === pathname) && (
        <nav className="chips" aria-label="Legal pages">
          {LEGAL_TABS.map(([href, label]) => (
            <Link key={href} href={href} className={`chip ${href === pathname ? "on" : ""}`} aria-current={href === pathname ? "page" : undefined}>
              {label}
            </Link>
          ))}
        </nav>
      )}
      <div>
        <h1 className="h1" style={{ fontSize: "clamp(30px, 6vw, 40px)" }}>
          {title}
        </h1>
        {s.updated && <span className="mu sm">Last updated {s.updated}</span>}
      </div>
      {toc.length > 1 && (
        <nav className="card" style={{ gap: 0, padding: "6px 14px" }} aria-label="Sections">
          {toc.map((t) => (
            <a key={t.id} href={`#${t.id}`} className="li">
              <b className="sm">{t.text}</b>
            </a>
          ))}
        </nav>
      )}
      <div ref={body} className="prose flex flex-col gap-3 [&_h2]:scroll-mt-20 [&_li]:ml-5 [&_li]:list-disc [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5 [&_a]:text-accent">
        {children(s)}
      </div>
    </article>
  );
}
