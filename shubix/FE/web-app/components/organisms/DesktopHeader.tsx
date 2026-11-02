"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/atoms/Icon";
import { MoreMenu, type MoreItem } from "@/components/molecules/MoreMenu";
import { NotificationBell } from "@/components/molecules/NotificationBell";
import { ProPill } from "@/components/molecules/ProPill";
import { InstallBanner } from "@/components/molecules/InstallBanner";
import { useText } from "@/hooks/useApi";

/** The computers' header (UI/ design): search the templates, the plan pill, the credits, the bell and the account
 * menu. Phones have the top bar instead (AppShell). */
export function DesktopHeader({ email, credits, admin, onSignOut }: { email?: string; credits: { balance: number; planName: string; plan?: string } | null; admin: boolean; onSignOut?: () => void }) {
  const text = useText();
  const router = useRouter();
  const [q, setQ] = useState("");
  const menu: MoreItem[] = [
    { label: text("nav.myAccount"), icon: "user", href: "/account" },
    { label: text("nav.pricing"), icon: "coins", href: "/pricing" },
    ...(admin ? [{ label: text("common.adminDashboard"), icon: "admin", href: "/admin" }] : []),
    ...(onSignOut ? [{ label: text("nav.signOut"), icon: "signout", onClick: onSignOut, danger: true }] : []),
  ];
  return (
    <header className="relative isolate sticky top-0 z-30 -mx-8 -mt-5 mb-6 hidden h-[76px] items-center gap-3 border-b border-[color-mix(in_srgb,var(--accent)_14%,var(--line))] bg-[color-mix(in_srgb,var(--bar)_88%,transparent)] px-5 shadow-[0_16px_40px_-34px_rgba(0,0,0,.72)] backdrop-blur-2xl md:flex lg:gap-5 lg:px-8 before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-accent/50 before:to-transparent before:content-['']">
      <div className="flex min-w-0 shrink-0 items-center gap-2.5 lg:gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] border border-accent/25 bg-accent/10 text-accent shadow-[0_8px_24px_-18px_var(--brand-glow)]">
          <Icon name="reels" size={20} stroke={1.8} />
        </span>
        <span className="hidden min-w-0 flex-col leading-tight lg:flex">
          <small className="text-[10px] font-extrabold tracking-[.18em] text-muted">SHUBIX · STUDIO</small>
          <strong className="mt-1 whitespace-nowrap font-[family-name:var(--font-display)] text-[14px] font-semibold tracking-[-.02em] text-foreground">Creator workspace</strong>
        </span>
      </div>
      <form
        role="search"
        className="flex h-11 min-w-0 w-full max-w-[min(36vw,440px)] items-center gap-2.5 rounded-[14px] border border-[color-mix(in_srgb,var(--accent)_16%,var(--line))] bg-[color-mix(in_srgb,var(--surface)_86%,transparent)] px-3.5 text-muted shadow-[0_1px_0_rgba(255,255,255,.04)_inset] transition-[border-color,box-shadow,background] duration-200 focus-within:border-accent/60 focus-within:bg-surface focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_14%,transparent)]"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(q.trim() ? `/templates?q=${encodeURIComponent(q.trim())}` : "/templates");
        }}
      >
        <Icon name="search" size={18} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={text("templates.headerSearch")} aria-label={text("templates.search")} className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted" />
      </form>
      <div className="ml-auto flex shrink-0 items-center gap-1.5 lg:gap-2.5">
        <InstallBanner />
        <ProPill plan={credits?.planName} planId={credits?.plan} />
        {credits && (
          <a href="/pricing" title={text("nav.creditsHint")} className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-[14px] border border-[color-mix(in_srgb,var(--accent)_18%,var(--line))] bg-[color-mix(in_srgb,var(--surface)_82%,transparent)] px-3 text-[13px] font-bold shadow-[0_1px_0_rgba(255,255,255,.035)_inset] transition-[border-color,background,transform] duration-200 hover:-translate-y-px hover:border-accent/50 hover:bg-surface">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-accent/12"><Icon name="bolt" size={14} stroke={2} color="var(--accent)" /></span>
            {credits.balance.toLocaleString("en-IN")}<span className="hidden capitalize text-muted lg:inline"> {text("nav.credits")}</span>
          </a>
        )}
        <NotificationBell />
        {/* the account menu: the person's initial, or a person when accounts are off (a local studio) */}
        <MoreMenu
          items={menu}
          label={text("common.account")}
          triggerClass="flex items-center gap-1.5 rounded-full p-0.5 pr-1.5 text-muted transition-colors hover:bg-surface-2"
          trigger={
            <>
              <span title={email} className="grid h-10 w-10 place-items-center rounded-full text-[15px] font-extrabold text-on-accent [background:var(--gold-gradient)]">
                {email ? email[0]?.toUpperCase() : <Icon name="user" size={20} stroke={2} />}
              </span>
              <Icon name="down" size={16} />
            </>
          }
        />
      </div>
    </header>
  );
}
