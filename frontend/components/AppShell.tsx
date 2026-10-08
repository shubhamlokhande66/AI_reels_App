"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ThemeToggle } from "./ThemeToggle";
import { GlobalActivity } from "./GlobalActivity";
import { useAdmin, useMe } from "@/hooks/useApi";

// What every user sees: the product. The admin section (settings, diagnostics, experimental tools) appears only in
// admin mode (lib/admin.ts); the server enforces it for the settings API too.
const GROUPS: { title: string; admin?: boolean; items: { href: string; label: string; icon: string }[] }[] = [
  {
    title: "Studio",
    items: [
      { href: "/", label: "Dashboard", icon: "◇" },
      { href: "/projects/new", label: "Create Reel", icon: "✦" },
      { href: "/story/new", label: "Story → Reel", icon: "❦" },
      { href: "/projects", label: "Projects", icon: "▤" },
    ],
  },
  {
    title: "Library",
    items: [
      { href: "/library", label: "Footage", icon: "▦" },
      { href: "/songs", label: "Songs", icon: "♬" },
      { href: "/templates", label: "Templates", icon: "◫" },
      { href: "/brands", label: "Brands", icon: "◈" },
    ],
  },
  {
    title: "Account",
    items: [{ href: "/pricing", label: "Plans & pricing", icon: "₹" }],
  },
  {
    title: "Admin",
    admin: true,
    items: [
      { href: "/settings", label: "AI settings", icon: "⚙" },
      { href: "/ai-edit/new", label: "AI Edit", icon: "❖" },
      { href: "/beats/new", label: "Beat Sync check", icon: "♪" },
      { href: "/chat", label: "Chat", icon: "◌" },
      { href: "/voices", label: "Voices", icon: "♫" },
      { href: "/trends", label: "My trends", icon: "↗" },
      { href: "/admin", label: "Admin mode", icon: "⚿" },
    ],
  },
];

// phones: the bottom bar (everything else is in the drawer behind "More")
const TABS: { href: string; label: string; icon: string; primary?: boolean }[] = [
  { href: "/", label: "Home", icon: "◇" },
  { href: "/projects", label: "Projects", icon: "▤" },
  { href: "/projects/new", label: "Create", icon: "✦", primary: true },
  { href: "/library", label: "Footage", icon: "▦" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/projects") return pathname === "/projects" || (pathname.startsWith("/projects/") && pathname !== "/projects/new");
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="group flex items-center gap-3">
      <span
        className={`lux-btn-gold grid place-items-center rounded-full font-display font-bold ${compact ? "h-9 w-9 text-base" : "h-10 w-10 text-lg"}`}
      >
        R
      </span>
      <span className="leading-tight">
        <span className={`block font-display font-semibold tracking-wide ${compact ? "text-lg" : "text-xl"}`}>Reel Maison</span>
        {!compact && <span className="block text-[10px] uppercase tracking-[0.28em] text-muted">AI creative studio</span>}
      </span>
    </Link>
  );
}

function NavGroups({ groups, pathname, onNavigate }: { groups: typeof GROUPS; pathname: string; onNavigate?: () => void }) {
  return (
    <>
      {groups.map((g) => (
        <div key={g.title} className="space-y-1">
          <p className="px-3 pb-1 text-[10px] uppercase tracking-[0.26em] text-muted/70">{g.title}</p>
          {g.items.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={`relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-200 ${
                  active
                    ? "bg-[linear-gradient(90deg,rgba(212,176,122,0.14),rgba(212,176,122,0.02))] text-foreground"
                    : "text-muted hover:bg-accent/5 hover:text-foreground"
                }`}
              >
                {active && <span aria-hidden className="absolute inset-y-1.5 left-0 w-[2px] rounded-full bg-accent" />}
                <span aria-hidden className={`w-4 text-center ${active ? "text-accent" : ""}`}>
                  {item.icon}
                </span>
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const { admin, loading } = useAdmin();
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const [drawer, setDrawer] = useState(false);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawer(false);
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // the page behind the open drawer does not scroll
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [drawer]);
  const authPage = pathname === "/login";
  const publicPage = pathname === "/pricing"; // open to everyone, also before signing in
  const signedOut = !!me.data?.authEnabled && !me.data.user;
  useEffect(() => {
    if (signedOut && !authPage && !publicPage) router.replace("/login"); // accounts on and nobody signed in: the sign-in page
  }, [signedOut, authPage, publicPage, router]);
  // an admin page opened by address in user mode: say so instead of showing it (the server guards its data too)
  const adminPage = GROUPS.some((g) => g.admin && g.items.some((i) => i.href !== "/admin" && isActive(pathname, i.href)));
  const blocked = adminPage && !admin && !loading;
  if (authPage || (signedOut && !publicPage)) {
    // the sign-in page stands alone, without the studio around it
    return (
      <main className="min-h-screen px-4 py-10">
        <GlobalActivity />
        <div className="mx-auto w-full max-w-6xl">{authPage ? children : null}</div>
      </main>
    );
  }

  const groups = GROUPS.filter((g) => !g.admin || admin);
  const signOut = async () => {
    await api.logout();
    await qc.invalidateQueries();
    router.replace("/login");
  };
  const account = (
    <>
      {me.data?.user && (
        <div className="mb-3 flex items-center justify-between gap-2 text-xs text-muted">
          <span className="truncate" title={me.data.user.email}>
            {me.data.user.email}
          </span>
          <button type="button" className="shrink-0 hover:text-accent" onClick={signOut}>
            Sign out
          </button>
        </div>
      )}
      <ThemeToggle className="mb-3 w-full justify-center" />
    </>
  );

  return (
    <div className="min-h-screen md:flex">
      <GlobalActivity />

      {/* phones: a top bar: the menu button on the left (the drawer opens from that side), the logo in the centre */}
      <header className="lux-sidebar sticky top-0 z-30 grid grid-cols-[2.5rem_1fr_2.5rem] items-center border-b border-border px-4 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] backdrop-blur-md md:hidden">
        <button
          type="button"
          aria-label="Open menu"
          aria-expanded={drawer}
          onClick={() => setDrawer(true)}
          className="grid h-10 w-10 place-items-center rounded-full border border-border text-lg transition-colors hover:border-accent/60 hover:text-accent"
        >
          ☰
        </button>
        <div className="flex justify-center">
          <Brand compact />
        </div>
        <span aria-hidden />
      </header>

      {/* phones: the slide-out drawer with every page */}
      <div className={`fixed inset-0 z-50 md:hidden ${drawer ? "" : "pointer-events-none"}`} aria-hidden={!drawer}>
        <div
          className={`absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${drawer ? "opacity-100" : "opacity-0"}`}
          onClick={() => setDrawer(false)}
        />
        <aside
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          className={`absolute inset-y-0 left-0 flex w-[82%] max-w-xs flex-col border-r border-border bg-background shadow-2xl transition-transform duration-300 ease-out ${
            drawer ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="lux-sidebar flex h-full flex-col">
            <div className="flex items-center justify-between px-5 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
              <Brand />
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setDrawer(false)}
                className="grid h-9 w-9 place-items-center rounded-full border border-border transition-colors hover:border-accent/60 hover:text-accent"
              >
                ✕
              </button>
            </div>
            <div className="lux-hairline mx-5" />
            <nav aria-label="Menu" className="flex-1 space-y-5 overflow-y-auto px-3 py-5">
              <NavGroups groups={groups} pathname={pathname} onNavigate={() => setDrawer(false)} />
            </nav>
            <div className="px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2">
              <div className="lux-hairline mb-4" />
              {account}
            </div>
          </div>
        </aside>
      </div>

      {/* desktop: the sidebar */}
      <aside className="lux-sidebar hidden border-r border-border md:sticky md:top-0 md:flex md:h-screen md:w-64 md:shrink-0 md:flex-col md:overflow-y-auto">
        <div className="px-6 pb-6 pt-8">
          <Brand />
        </div>
        <div className="lux-hairline mx-6" />
        <nav aria-label="Main" className="flex-1 space-y-6 px-4 py-6">
          <NavGroups groups={groups} pathname={pathname} />
        </nav>
        <div className="px-6 pb-8 pt-2">
          <div className="lux-hairline mb-4" />
          {account}
          <Link href="/projects/new" className="lux-btn-gold flex items-center justify-center rounded-full px-4 py-2.5 text-sm font-semibold">
            ✦ New Reel
          </Link>
        </div>
      </aside>

      {/* phones: the bottom tab bar */}
      <nav
        aria-label="Quick"
        className="lux-sidebar fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 items-end border-t border-border px-1 pb-[max(0.4rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-md md:hidden"
      >
        {TABS.map((t) => {
          const active = isActive(pathname, t.href);
          if (t.primary)
            return (
              <Link key={t.href} href={t.href} aria-label={t.label} className="flex flex-col items-center gap-0.5 text-[11px] text-muted">
                <span className="lux-btn-gold -mt-6 grid h-12 w-12 place-items-center rounded-full text-xl shadow-lg ring-4 ring-background">
                  ✦
                </span>
                <span className={active ? "text-accent" : ""}>{t.label}</span>
              </Link>
            );
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-col items-center gap-0.5 rounded-xl py-1 text-[11px] transition-colors ${
                active ? "text-accent" : "text-muted hover:text-foreground"
              }`}
            >
              <span aria-hidden className="text-lg leading-6">
                {t.icon}
              </span>
              {t.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setDrawer(true)}
          className={`flex flex-col items-center gap-0.5 rounded-xl py-1 text-[11px] transition-colors ${
            drawer ? "text-accent" : "text-muted hover:text-foreground"
          }`}
        >
          <span aria-hidden className="text-lg leading-6">
            ☰
          </span>
          More
        </button>
      </nav>

      <main className="min-w-0 flex-1 px-4 pb-28 pt-5 md:px-12 md:py-10">
        <div className="mx-auto w-full max-w-6xl">
          {blocked ? (
            <div className="lux-card lux-enter mx-auto mt-16 max-w-md rounded-3xl p-8 text-center">
              <p className="lux-eyebrow">Admin only</p>
              <h1 className="mt-2 font-display text-3xl">This page is for the administrator</h1>
              <p className="mt-2 text-sm text-muted">Settings and diagnostic tools are managed by the administrator of this studio.</p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Link href="/" className="lux-btn-gold rounded-full px-5 py-2.5 text-sm font-semibold">
                  Back to the studio
                </Link>
                <Link href="/admin" className="rounded-full border border-border px-5 py-2.5 text-sm hover:border-accent/60">
                  Admin sign-in
                </Link>
              </div>
            </div>
          ) : (
            children
          )}
        </div>
      </main>
    </div>
  );
}
