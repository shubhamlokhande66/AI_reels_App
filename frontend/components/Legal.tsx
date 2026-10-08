"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
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

/** The business details, with a placeholder where the admin has not filled one in yet. */
export function siteOr(site: SiteInfo | undefined) {
  return {
    name: site?.businessName || "Reel Maison",
    email: site?.supportEmail || "[support email: set SUPPORT_EMAIL]",
    phone: site?.supportPhone || "",
    address: site?.businessAddress || "[business address: set BUSINESS_ADDRESS]",
    updated: site?.legalUpdated || "",
  };
}

export function LegalFooter({ className = "" }: { className?: string }) {
  return (
    <nav aria-label="Legal" className={`flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted ${className}`}>
      {LEGAL_LINKS.map(([href, label]) => (
        <Link key={href} href={href} className="hover:text-accent">
          {label}
        </Link>
      ))}
      <Link href="/pricing" className="hover:text-accent">
        Pricing
      </Link>
    </nav>
  );
}

/** A readable legal page: title, last-updated date, sections. */
export function LegalPage({ title, children }: { title: string; children: (s: ReturnType<typeof siteOr>) => React.ReactNode }) {
  const site = useSite();
  const s = siteOr(site.data);
  return (
    <article className="lux-enter mx-auto max-w-3xl">
      <p className="lux-eyebrow">{s.name}</p>
      <h1 className="mt-2 font-display text-4xl">{title}</h1>
      {s.updated && <p className="mt-1 text-sm text-muted">Last updated: {s.updated}</p>}
      <div className="legal mt-8 space-y-6 text-[15px] leading-relaxed text-foreground/90 [&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:text-foreground [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">
        {children(s)}
      </div>
      <LegalFooter className="mt-12 border-t border-border pt-6" />
    </article>
  );
}
