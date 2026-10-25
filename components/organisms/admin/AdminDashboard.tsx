"use client";

import Link from "next/link";
import { useCallback, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Icon, Logo } from "@/components/atoms";
import { ThemeToggle } from "@/components/molecules/ThemeToggle";
import { AiSettingsPanel } from "@/components/organisms/AiSettingsPanel";
import { TrendLibrary } from "@/components/organisms/TrendLibrary";
import { useMe } from "@/hooks/useApi";
import { getAdminKey, setAdminKey } from "@/lib/admin";
import { LiveDot, OverviewTab, useOverview } from "./OverviewTab";
import { ErrorsTab } from "./ErrorsTab";
import { TemplatesTab } from "./TemplatesTab";
import { SettingsTab } from "./SettingsTab";
import { UserPanel } from "./UserPanel";
import { UsersTab } from "./UsersTab";

/** The admin panel (like the shop's): a grouped sidebar, a header with who is online and Refresh, then the open tab. */
type Tab = "overview" | "users" | "templates" | "settings" | "errors" | "ai" | "trends";
const NAV: { title: string; items: { id: Tab; label: string; icon: string; hint: string }[] }[] = [
  { title: "Overview", items: [{ id: "overview", label: "Dashboard", icon: "home", hint: "Visitors, sign-ups, revenue and credits at a glance" }] },
  { title: "People", items: [{ id: "users", label: "Users", icon: "user", hint: "Everyone who signed up: logins, purchases, credits left" }] },
  { title: "Content", items: [{ id: "templates", label: "Templates", icon: "grid", hint: "Every template of the studio: add, change, hide, order, its times and its days" }] },
  { title: "System", items: [{ id: "settings", label: "Settings", icon: "gear", hint: "Every setting of the studio, managed here" }, { id: "errors", label: "Errors", icon: "key", hint: "What broke in people's browsers, newest first" }] },
  // the AI's tools open here too (before, they were links that left the dashboard)
  { title: "Tools", items: [{ id: "ai", label: "AI settings", icon: "wand", hint: "Which AI does each job, and how the AI director did. Changes apply to new Reels." },
    { id: "trends", label: "My trends", icon: "trend", hint: "Give a trending Reel; its cuts, pace and look are learned." }] },
];
const TABS = NAV.flatMap((g) => g.items);
const fromHash = (): Tab => {
  const h = typeof window === "undefined" ? "" : window.location.hash.slice(1);
  return TABS.some((t) => t.id === h) ? (h as Tab) : "overview";
};
const onHash = (fn: () => void) => {
  window.addEventListener("hashchange", fn);
  return () => window.removeEventListener("hashchange", fn);
};
const never = () => () => {};

export function AdminDashboard() {
  const qc = useQueryClient();
  const me = useMe();
  const overview = useOverview();
  const tab = useSyncExternalStore(onHash, fromHash, () => "overview" as Tab); // the open tab is in the address (#users)
  const [menu, setMenu] = useState(false);
  const [user, setUser] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const byKey = useSyncExternalStore(never, () => Boolean(getAdminKey()), () => false); // unlocked with the ADMIN_KEY
  const setTab = (t: Tab) => {
    setMenu(false);
    history.replaceState(null, "", t === "overview" ? location.pathname : `#${t}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  };
  const refresh = useCallback(async () => {
    setRefreshing(true);
    await qc.invalidateQueries({ queryKey: ["admin"] });
    setRefreshing(false);
  }, [qc]);
  async function leave() {
    setAdminKey(null);
    await qc.invalidateQueries();
  }
  const current = TABS.find((t) => t.id === tab)!;
  const email = me.data?.user?.email;

  const sidebar = (
    <>
      <div className="flex items-center gap-2.5 px-1 pb-2">
        <Logo height={48} />
        <span className="inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[11px] font-bold bg-[var(--chip-on)] text-accent ml-auto">Admin</span>
      </div>
      <nav aria-label="Admin" className="flex flex-col gap-3">
        {NAV.map((g) => (
          <div key={g.title} className="flex flex-col gap-0.5">
            <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted px-2.5 pb-1">{g.title}</span>
            {/* the CMS is its own dashboard: it opens in a new tab */}
            {g.title === "Content" && (
              <a href="/cms" target="_blank" rel="noreferrer" title="Every page's texts, section by section; plans & pricing, plan locks, ads, the payment window"
                className="flex min-h-[40px] items-center gap-3 rounded-[10px] px-2.5 text-left text-[13.5px] text-muted transition-colors hover:bg-accent/6 hover:text-foreground">
                <Icon name="text" size={18} stroke={1.7} />
                CMS
                <span className="ml-auto text-[11px]" aria-hidden>↗</span>
              </a>
            )}
            {g.items.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className={`flex min-h-[40px] items-center gap-3 rounded-[10px] px-2.5 text-left text-[13.5px] transition-colors ${
                  tab === t.id ? "bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] font-bold text-foreground" : "text-muted hover:bg-[color-mix(in_srgb,var(--accent)_6%,transparent)] hover:text-foreground"
                }`}
              >
                <Icon name={t.icon} size={18} stroke={1.7} color={tab === t.id ? "var(--accent)" : undefined} />
                {t.label}
                {tab === t.id && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent" />}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="flex-1" />
      <ThemeToggle />
      {byKey && (
        <button type="button" className="flex items-center gap-2.5 text-muted text-[12.5px] min-h-[40px] px-1 text-left hover:text-foreground" onClick={() => void leave()}>
          <Icon name="key" size={18} />
          Leave admin mode
        </button>
      )}
      <Link href="/" className="flex items-center gap-2.5 text-muted text-[12.5px] min-h-[40px] px-1 hover:text-foreground">
        <Icon name="signout" size={18} />
        Back to the studio
      </Link>
    </>
  );

  return (
    <div className="flex min-h-screen">
      {/* computers: the sidebar */}
      <aside className="hidden border-r border-border [background:var(--sidebar)] md:fixed md:inset-y-0 md:left-0 md:z-30 md:flex md:w-60 md:flex-col md:gap-3 md:overflow-y-auto md:px-4 md:py-5 [&>*]:shrink-0">
        {sidebar}
      </aside>
      {/* phones: the same sidebar as a drawer */}
      {menu && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-[var(--overlay)]" onClick={() => setMenu(false)} />
          <aside role="dialog" aria-modal="true" aria-label="Admin menu" className="absolute inset-y-0 left-0 flex w-[82%] max-w-[300px] flex-col gap-3 overflow-y-auto bg-background px-4 py-5 shadow-2xl">
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col md:ml-60">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-[var(--bar)] px-4 md:px-6">
          <button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-border p-0 text-foreground transition-colors hover:text-accent border-0 bg-transparent md:hidden" aria-label="Open admin menu" onClick={() => setMenu(true)}>
            <Icon name="menu" size={22} />
          </button>
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-bold">{current.label}</span>
            <span className="text-muted hidden truncate text-[11px] sm:block">{current.hint}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {overview.data && (
              <button type="button" className="inline-flex h-[34px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-surface px-3.5 text-[12.5px] font-semibold text-foreground transition-colors hover:border-accent/50" onClick={() => setTab("overview")} title="Visitors on the site right now">
                <LiveDot />
                {overview.data.visitors.online} online
              </button>
            )}
            <button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border bg-surface p-0 text-foreground transition-colors hover:text-accent" aria-label="Refresh" title="Load everything again" onClick={() => void refresh()} disabled={refreshing}>
              <Icon name="refresh" size={18} className={refreshing ? "animate-spin" : ""} />
            </button>
            {email && (
              <span className="hidden items-center gap-2 border-l border-border pl-3 lg:flex">
                <span className="grid h-8 w-8 place-items-center rounded-full font-bold text-[var(--on-accent)] [background:var(--gold-gradient)]">{email[0]?.toUpperCase()}</span>
                <span className="text-[12.5px] max-w-[180px] truncate">{email}</span>
              </span>
            )}
          </div>
        </header>
        <main className="min-w-0 flex-1 px-4 py-5 md:px-6">
          <div className="mx-auto w-full max-w-7xl">
            {tab === "overview" && <OverviewTab onOpenUser={setUser} onOpenTab={setTab} />}
            {tab === "users" && <UsersTab onOpenUser={setUser} />}
            {tab === "settings" && <SettingsTab />}
            {tab === "templates" && <TemplatesTab />}
            {tab === "errors" && <ErrorsTab />}
            {tab === "ai" && <AiSettingsPanel />}
            {tab === "trends" && <TrendLibrary embedded />}
          </div>
        </main>
      </div>
      {user && <UserPanel id={user} onClose={() => setUser(null)} />}
    </div>
  );
}
