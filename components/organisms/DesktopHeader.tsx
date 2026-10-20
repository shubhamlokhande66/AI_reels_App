"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/atoms/Icon";
import { MoreMenu, type MoreItem } from "@/components/molecules/MoreMenu";
import { NotificationBell } from "@/components/molecules/NotificationBell";
import { ProPill } from "@/components/molecules/ProPill";

/** The computers' header (UI/ design): search the templates, the plan pill, the credits, the bell and the account
 * menu. Phones have the top bar instead (AppShell). */
export function DesktopHeader({ email, credits, admin, onSignOut }: { email?: string; credits: { balance: number; planName: string } | null; admin: boolean; onSignOut?: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const menu: MoreItem[] = [
    { label: "My account", icon: "user", href: "/account" },
    { label: "Pricing & plans", icon: "coins", href: "/pricing" },
    ...(admin ? [{ label: "Admin dashboard", icon: "admin", href: "/admin" }] : []),
    ...(onSignOut ? [{ label: "Sign out", icon: "signout", onClick: onSignOut, danger: true }] : []),
  ];
  return (
    <header className="sticky top-0 z-30 -mx-8 -mt-5 mb-5 hidden h-[68px] items-center gap-4 border-b border-border bg-[var(--bar)] px-8 md:flex">
      <form
        role="search"
        className="flex h-11 w-full min-w-0 max-w-[420px] items-center gap-2.5 rounded-xl border border-border bg-surface px-3.5 text-muted transition-[border-color,box-shadow] focus-within:border-accent focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_22%,transparent)]"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(q.trim() ? `/templates?q=${encodeURIComponent(q.trim())}` : "/templates");
        }}
      >
        <Icon name="search" size={18} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search templates, music, effects…" aria-label="Search templates" className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted" />
      </form>
      <div className="ml-auto flex shrink-0 items-center gap-2 lg:gap-3">
        <ProPill plan={credits?.planName} />
        {credits && (
          <a href="/pricing" title="Your credits: plans and top-ups" className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-xl border border-border bg-surface px-3.5 text-[14px] font-bold transition-colors hover:border-accent/60">
            <Icon name="bolt" size={18} stroke={2} color="#6d8bff" />
            {credits.balance.toLocaleString("en-IN")}<span className="hidden lg:inline"> Credits</span>
          </a>
        )}
        <NotificationBell />
        {/* the account menu: the person's initial, or a person when accounts are off (a local studio) */}
        <MoreMenu
          items={menu}
          label="Account"
          triggerClass="flex items-center gap-1.5 rounded-full p-0.5 pr-1.5 text-muted transition-colors hover:bg-surface-2"
          trigger={
            <>
              <span title={email} className="grid h-10 w-10 place-items-center rounded-full text-[15px] font-extrabold text-white [background:var(--gold-gradient)]">
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
