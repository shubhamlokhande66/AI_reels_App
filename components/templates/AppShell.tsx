"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { applyTheme } from "@/lib/theme";
import { useTheme } from "@/lib/useTheme";
import { ThemeToggle } from "@/components/molecules/ThemeToggle";
import { ConfirmHost } from "@/components/molecules/ConfirmDialog";
import { Icon } from "@/components/atoms/Icon";
import { Logo } from "@/components/atoms/Logo";
import { GlobalActivity } from "@/components/molecules/GlobalActivity";
import { LegalFooter } from "@/components/molecules/Legal";
import { EmptyState } from "@/components/molecules/EmptyState";
import { InstallApp } from "@/components/molecules/InstallApp";
import { TOP_SLOT, useCustomTitle } from "@/components/templates/TopBar";
import { useAdmin, useCredits, useFeatures, useMe } from "@/hooks/useApi";
import { FEATURE_LIST, linkOn, pageFeature } from "@/lib/features-list";

// The app's frame, as designed: a Noir sidebar on computers; on phones a top bar (menu or back · title · credits),
// a bottom tab bar on Home, Projects and Editor, and a Noir menu drawer. The admin section (settings, diagnostics,
// experimental tools) appears only in admin mode (lib/admin.ts); the server enforces it for the settings API too.
export const GROUPS: { title: string; admin?: boolean; items: { href: string; label: string; icon: string; fullLoad?: boolean }[] }[] = [
  {
    title: "Studio",
    items: [
      { href: "/", label: "Home", icon: "home" },
      { href: "/projects/new", label: "Create Reel", icon: "plus" },
      // a full page load: the studio is cross-origin isolated (next.config.ts) so its AI beat tracker can use several cores
      { href: "/studio", label: "Fast Studio", icon: "bolt", fullLoad: true },
      { href: "/reels", label: "My Reels", icon: "video" },
      { href: "/story/new", label: "Story → Reel", icon: "book" },
      { href: "/editor", label: "Editor", icon: "scissors" },
    ],
  },
  {
    title: "Library",
    items: [
      { href: "/projects", label: "Projects", icon: "projects" },
      { href: "/library", label: "Footage", icon: "image" },
      { href: "/songs", label: "Songs", icon: "music" },
      { href: "/templates", label: "Templates", icon: "grid" },
      { href: "/brands", label: "Brands", icon: "star" },
    ],
  },
  {
    title: "Account",
    items: [
      { href: "/account", label: "My account", icon: "user" },
      { href: "/pricing", label: "Pricing & plans", icon: "coins" },
    ],
  },
  {
    title: "Admin",
    admin: true,
    items: [
      { href: "/settings", label: "AI settings", icon: "gear" },
      { href: "/ai-edit/new", label: "AI Edit", icon: "wand" },
      { href: "/beats/new", label: "Beat Sync check", icon: "wave" },
      { href: "/chat", label: "Chat", icon: "chat" },
      { href: "/voices", label: "Voice profiles", icon: "mic" },
      { href: "/trends", label: "My trends", icon: "trend" },
      { href: "/admin", label: "Admin mode", icon: "key" },
    ],
  },
];

const AUTH_PAGES = ["/login", "/forgot", "/reset"];
const PUBLIC_PAGES = ["/pricing", "/terms", "/privacy", "/refunds", "/contact"];

export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/projects") return pathname === "/projects" || (pathname.startsWith("/projects/") && pathname !== "/projects/new");
  return pathname === href || pathname.startsWith(`${href}/`);
}

type Meta = { title: string; back?: string; left?: boolean; credits?: boolean; tabs?: boolean; admin?: boolean };

/** What the phone top bar shows on each page (the designs). */
function pageMeta(p: string): Meta {
  const fixed: Record<string, Meta> = {
    "/": { title: "Shubix", credits: true, tabs: true },
    "/projects": { title: "My Projects", credits: true, tabs: true },
    "/reels": { title: "My Reels", credits: true, tabs: true },
    "/projects/new": { title: "Create a new Reel", back: "/", credits: true },
    "/story/new": { title: "Story → Reel", back: "/", credits: true },
    "/editor": { title: "Editor", credits: true, tabs: true },
    "/studio": { title: "Fast Studio", credits: true },
    "/library": { title: "Media Library" },
    "/songs": { title: "My songs" },
    "/templates": { title: "Templates" },
    "/brands": { title: "My Brands" },
    "/account": { title: "My account" },
    "/pricing": { title: "Pricing & plans", credits: true },
    "/terms": { title: "Legal", back: "/" },
    "/privacy": { title: "Legal", back: "/" },
    "/refunds": { title: "Legal", back: "/" },
    "/contact": { title: "Contact us" },
    "/settings": { title: "AI settings", admin: true },
    "/ai-edit/new": { title: "AI Edit", admin: true },
    "/beats/new": { title: "Beat Sync check", admin: true },
    "/chat": { title: "Chat", admin: true },
    "/voices": { title: "Voice profiles", admin: true },
    "/trends": { title: "My trends", admin: true },
    "/admin": { title: "Administration" },
  };
  if (fixed[p]) return fixed[p];
  const m = p.match(/^\/projects\/([^/]+)(\/(edit|beats))?$/);
  if (m) return { title: m[3] === "edit" ? "Edit" : "Project", back: m[2] ? `/projects/${m[1]}` : "/projects", left: true };
  return { title: "Shubix" };
}

/** The signed-in user's credits (billing on): tap to see plans and top up. */
function CreditPill({ balance, full = false }: { balance: number; full?: boolean }) {
  return (
    <Link href="/pricing" title="Your credits: plans and top-ups" className={`cred ${balance <= 2 ? "low" : ""}`}>
      <i aria-hidden />
      {balance.toLocaleString("en-IN")}
      <span className={full ? "" : "sr-only"}> credits</span>
    </Link>
  );
}

/** The sidebar's and the drawer's page list. */
export function NavGroups({ groups, pathname, onNavigate }: { groups: typeof GROUPS; pathname: string; onNavigate?: () => void }) {
  return (
    <>
      {groups.map((g) => (
        <div key={g.title} className="flex flex-col gap-0.5">
          <span className="eb px-2.5 pb-1 pt-3 first:pt-1">{g.title}</span>
          {g.items.map((item) => {
            const active = isActive(pathname, item.href);
            const Tag = item.fullLoad ? "a" : Link;
            return (
              <Tag
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-[40px] items-center gap-3 rounded-[10px] px-2.5 text-[13.5px] transition-colors ${
                  active ? "bg-[rgba(212,176,122,.12)] font-bold text-foreground" : "text-muted hover:bg-[rgba(212,176,122,.06)] hover:text-foreground"
                }`}
              >
                <Icon name={item.icon} size={18} stroke={1.7} color={active ? "#d4b07a" : undefined} />
                {item.label}
              </Tag>
            );
          })}
        </div>
      ))}
    </>
  );
}

function Avatar({ email, size = 36 }: { email?: string; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden>
      {(email?.[0] ?? "R").toUpperCase()}
    </span>
  );
}

/** Phones: the Noir drawer with every page (design: Menu). */
function Drawer({ open, onClose, groups, pathname, email, credits, onSignOut }: {
  open: boolean;
  onClose: () => void;
  groups: typeof GROUPS;
  pathname: string;
  email?: string;
  credits: { balance: number; planName: string } | null;
  onSignOut?: () => void;
}) {
  // the design's list: the main pages first, then the admin section in admin mode
  const main = groups.filter((g) => !g.admin).flatMap((g) => g.items).filter((i) => i.href !== "/story/new" && i.href !== "/pricing");
  const admin = groups.find((g) => g.admin);
  const link = (item: (typeof main)[number]) => {
    const active = isActive(pathname, item.href);
    const Tag = item.fullLoad ? "a" : Link;
    return (
      <Tag
        key={item.href}
        href={item.href}
        onClick={onClose}
        aria-current={active ? "page" : undefined}
        className={`row min-h-[44px] rounded-xl px-2.5 ${active ? "bg-[rgba(212,176,122,.12)] font-bold" : ""}`}
      >
        <Icon name={item.icon} size={20} stroke={1.7} color={active ? "#d4b07a" : "#a69d90"} />
        {item.label}
      </Tag>
    );
  };
  return (
    <div className={`fixed inset-0 z-50 md:hidden ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      <div className={`absolute inset-0 bg-black/55 backdrop-blur-sm transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0"}`} onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        className={`absolute inset-y-0 left-0 flex w-[86%] max-w-[340px] flex-col bg-background text-foreground shadow-2xl transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="top" style={{ gridTemplateColumns: "1fr 44px" }}>
          <span className="flex min-w-0 items-center">
            <Logo height={34} />
          </span>
          <button type="button" className="ib plain" aria-label="Close menu" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-4 pt-3">
          {email && (
            <div className="row px-1 pb-2.5 pt-1">
              <Avatar email={email} />
              <span className="mu sm truncate">{email}</span>
            </div>
          )}
          <nav aria-label="Pages" className="flex flex-col">
            {main.map(link)}
          </nav>
          {admin && (
            <nav aria-label="Admin pages" className="flex flex-col">
              <span className="eb px-2.5 pb-1 pt-3">Admin</span>
              {admin.items.map(link)}
            </nav>
          )}
          <div className="flex-1" />
          <ThemeToggle className="mt-2" />
          <InstallApp className="px-1 pt-2" />
          {credits && (
            <div className="between px-1 py-2.5">
              <span onClick={onClose}>
                <CreditPill balance={credits.balance} full />
              </span>
              <span className="mu sm">{credits.planName} plan</span>
            </div>
          )}
          {onSignOut && (
            <button type="button" onClick={onSignOut} className="row mu sm min-h-[44px] px-1 text-left">
              <Icon name="signout" size={18} />
              Sign out
            </button>
          )}
          <div className="pb-[env(safe-area-inset-bottom)]" />
        </div>
      </aside>
    </div>
  );
}

// Create opens Fast Studio when the server's Create Reel is off (Administration -> Features); at most four tabs and More
const TABS: { href: string; label: string; icon: string; primary?: boolean; full?: boolean }[] = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/reels", label: "My Reels", icon: "video" },
  { href: "/projects/new", label: "Create", icon: "plus", primary: true },
  { href: "/templates", label: "Templates", icon: "grid" },
  { href: "/projects", label: "Projects", icon: "projects" },
  { href: "/editor", label: "Editor", icon: "scissors" },
];
const tabsFor = (f: Parameters<typeof linkOn>[1]) =>
  TABS.map((t) => (t.primary && !linkOn(t.href, f) ? { ...t, href: "/studio", full: true } : t))
    .filter((t) => linkOn(t.href, f))
    .slice(0, 4);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const { admin, loading } = useAdmin();
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const [drawer, setDrawer] = useState(false);
  const creditsQ = useCredits();
  const credits = creditsQ.data?.enabled ? creditsQ.data : null;
  const [needCredits, setNeedCredits] = useState<string | null>(null);
  const customTitle = useCustomTitle();

  // one look for every page: the person's choice (Light / Dark / same as the phone), kept on this device
  const { pref } = useTheme();
  useEffect(() => {
    applyTheme(pref);
  }, [pref, pathname]);
  const [navPath, setNavPath] = useState(pathname);
  if (navPath !== pathname) {
    // a new page: the menu closes
    setNavPath(pathname);
    setDrawer(false);
  }
  useEffect(() => {
    const on = (e: Event) => {
      setNeedCredits((e as CustomEvent<string>).detail || "You've used all your credits.");
      void qc.invalidateQueries({ queryKey: ["credits"] });
    };
    window.addEventListener("credits:needed", on);
    return () => window.removeEventListener("credits:needed", on);
  }, [qc]);
  useEffect(() => {
    if (!drawer && !needCredits) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawer(false);
        setNeedCredits(null);
      }
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // the page behind the open drawer does not scroll
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [drawer, needCredits]);
  const authPage = AUTH_PAGES.includes(pathname); // sign in, forgot / reset password: shown on their own
  const publicPage = PUBLIC_PAGES.includes(pathname); // open to everyone, also before signing in
  const signedOut = !!me.data?.authEnabled && !me.data.user;
  useEffect(() => {
    if (signedOut && !authPage && !publicPage) router.replace("/login"); // accounts on and nobody signed in: the sign-in page
  }, [signedOut, authPage, publicPage, router]);
  // an admin page opened by address in user mode: say so instead of showing it (the server guards its data too)
  const adminPage = GROUPS.some((g) => g.admin && g.items.some((i) => i.href !== "/admin" && isActive(pathname, i.href)));
  const blocked = adminPage && !admin && !loading;
  // a part of the app the administrator turned off: hidden from the menus; its page says so (the admin still sees it)
  const features = useFeatures();
  const offKey = pageFeature(pathname, features);
  const off = offKey && !features[offKey] ? FEATURE_LIST.find((f) => f.key === offKey)! : null;
  if (pathname.startsWith("/editor/") && !signedOut) {
    // the Pro editor is a full-screen workspace (like CapCut): no sidebar or bottom bar
    return (
      <main className="rm min-h-screen">
        <GlobalActivity />
        {children}
      </main>
    );
  }
  if (authPage || (signedOut && !publicPage)) {
    // the sign-in pages stand alone, without the studio around them
    return (
      <main className="rm min-h-screen">
        <GlobalActivity />
        {authPage ? children : null}
      </main>
    );
  }

  const groups = GROUPS.filter((g) => !g.admin || admin)
    .map((g) => ({ ...g, items: g.items.filter((i) => linkOn(i.href, features)) }))
    .filter((g) => g.items.length); // a heading whose parts are all off is not shown
  const newReel = linkOn("/projects/new", features) ? "/projects/new" : "/studio"; // Fast Studio when Create Reel is off
  const signOut = me.data?.user
    ? async () => {
        await api.logout();
        await qc.invalidateQueries();
        router.replace("/login");
      }
    : undefined;
  const meta = pageMeta(pathname);
  const title = customTitle ?? meta.title;
  const back = meta.back;

  return (
    <div className="rm min-h-screen md:flex">
      <GlobalActivity />
      <ConfirmHost />

      {/* phones: the top bar */}
      <header className="top sticky top-0 z-30 md:hidden">
        {back ? (
          <button
            type="button"
            className="ib plain"
            aria-label="Back"
            onClick={() => (window.history.length > 1 ? router.back() : router.push(back))}
          >
            <Icon name="back" />
          </button>
        ) : (
          <button type="button" className="ib plain" aria-label="Open menu" aria-expanded={drawer} onClick={() => setDrawer(true)}>
            <Icon name="menu" size={22} />
          </button>
        )}
        <span className={`t ${meta.left ? "l" : ""}`}>{pathname === "/" ? <Logo height={34} className="mx-auto" /> : title}</span>
        <span className="flex items-center justify-end gap-2 [&:has(#rm-top-action:not(:empty))>.dflt]:hidden">
          <span id={TOP_SLOT} className="contents" />
          <span className="dflt contents">
            {meta.admin ? <span className="badge b-run">Admin</span> : meta.credits && credits ? <CreditPill balance={credits.balance} /> : null}
          </span>
        </span>
      </header>

      <Drawer
        open={drawer}
        onClose={() => setDrawer(false)}
        groups={groups}
        pathname={pathname}
        email={me.data?.user?.email}
        credits={credits}
        onSignOut={signOut}
      />

      {/* computers: the Noir sidebar */}
      <aside className="hidden border-r border-border text-foreground [background:var(--sidebar)] md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0 md:flex-col md:gap-4 md:overflow-y-auto md:px-4 md:py-[22px]">
        <Link href="/" className="flex" aria-label="Shubix home">
          <Logo height={80} className="-mx-1 max-w-full" />
        </Link>
        {newReel === "/studio" ? (
          <a href="/studio" className="btn g">
            + New Reel
          </a>
        ) : (
          <Link href="/projects/new" className="btn g">
            + New Reel
          </Link>
        )}
        <nav aria-label="Main" className="flex flex-col">
          <NavGroups groups={groups} pathname={pathname} />
        </nav>
        <div className="flex-1" />
        <ThemeToggle />
        <InstallApp />
        {credits && (
          <div className="between">
            <CreditPill balance={credits.balance} full />
            <span className="mu xs">{credits.planName} plan</span>
          </div>
        )}
        {me.data?.user && (
          <div className="between xs mu">
            <span className="truncate" title={me.data.user.email}>
              {me.data.user.email}
            </span>
            <button type="button" className="shrink-0 font-bold hover:text-accent" onClick={signOut}>
              Sign out
            </button>
          </div>
        )}
      </aside>

      {/* phones: the bottom tab bar (Home, Projects, Editor) */}
      {meta.tabs && (
        <nav aria-label="Quick" className="tabbar fixed inset-x-0 bottom-0 z-40 md:hidden">
          {tabsFor(features).map((t) => {
            const active = isActive(pathname, t.href);
            const Tag = t.full ? "a" : Link;
            return (
              <Tag key={t.href} href={t.href} aria-label={t.primary ? t.label : undefined} aria-current={active ? "page" : undefined} className={active && !t.primary ? "on" : ""}>
                {t.primary ? (
                  <span className="cr">
                    <Icon name="plus" size={22} stroke={2.2} />
                  </span>
                ) : (
                  <Icon name={t.icon} size={22} stroke={1.7} />
                )}
                {t.label}
              </Tag>
            );
          })}
          <button type="button" onClick={() => setDrawer(true)} className={drawer ? "on" : ""}>
            <Icon name="menu" size={22} stroke={1.7} />
            More
          </button>
        </nav>
      )}

      {needCredits && (
        <div className="noir fixed inset-0 z-[90] grid place-items-center bg-[rgba(5,4,4,.82)] p-5 backdrop-blur-sm" onClick={() => setNeedCredits(null)}>
          <div role="dialog" aria-modal="true" aria-label="Not enough credits" className="card lux-enter w-full max-w-sm items-center gap-2.5 px-5 py-[26px] text-center" style={{ borderColor: "#3a3128" }} onClick={(e) => e.stopPropagation()}>
            <span className="grid h-[72px] w-[72px] place-items-center rounded-full bg-[rgba(212,176,122,.12)] text-[#d4b07a]">
              <Icon name="coins" size={36} stroke={1.5} />
            </span>
            <span className="eb">Credits</span>
            <h2 className="ht" style={{ fontSize: 26 }}>
              Not enough credits
            </h2>
            <span className="mu sm">{needCredits} Top up or choose a plan to keep making Reels.</span>
            <Link href="/pricing" onClick={() => setNeedCredits(null)} className="btn g big mt-1.5">
              See plans &amp; top-ups
            </Link>
            <button type="button" className="btn w-full" onClick={() => setNeedCredits(null)}>
              Not now
            </button>
          </div>
        </div>
      )}

      <main className={`min-w-0 flex-1 px-4 pt-4 md:px-8 md:pb-10 md:pt-5 ${meta.tabs ? "pb-28" : "pb-10"}`}>
        <div className="mx-auto w-full max-w-6xl">
          {back && (
            <button
              type="button"
              onClick={() => (window.history.length > 1 ? router.back() : router.push(back))}
              className="row mu sm mb-2 hidden font-bold hover:text-accent md:inline-flex"
            >
              <Icon name="back" size={16} />
              Back
            </button>
          )}
          {blocked ? (
            <div className="noir mx-auto mt-10 max-w-sm rounded-[20px] bg-[#050404] p-5">
              <div role="dialog" aria-label="Admin only" className="card items-center gap-2.5 px-5 py-[26px] text-center" style={{ borderColor: "#3a3128" }}>
                <span className="grid h-[72px] w-[72px] place-items-center rounded-full bg-[rgba(212,176,122,.12)] text-[#d4b07a]">
                  <Icon name="shield" size={34} stroke={1.5} />
                </span>
                <span className="eb">Admin only</span>
                <h1 className="ht" style={{ fontSize: 24 }}>
                  This page is for the administrator
                </h1>
                <span className="mu sm">Please sign in with an admin account to continue.</span>
                <div className="g2 mt-1.5 w-full">
                  <Link href="/" className="btn">
                    Back
                  </Link>
                  <Link href="/admin" className="btn g">
                    Admin sign-in
                  </Link>
                </div>
              </div>
            </div>
          ) : off && !admin ? (
            <div className="mx-auto mt-6 max-w-md">
              <EmptyState
                icon="lock"
                title={`${off.label} is turned off`}
                hint="The studio's administrator has switched this part of the app off. Everything else works as usual."
                action={
                  <Link href="/" className="btn g">
                    Back to Home
                  </Link>
                }
              />
            </div>
          ) : (
            <>
              {off && (
                <p role="status" className="card sm mb-3" style={{ color: "var(--warning)" }}>
                  {off.label} is turned off for everyone else. You see it because you are the administrator.
                </p>
              )}
              {children}
            </>
          )}
          <LegalFooter className="mt-12 border-t border-border pt-5" />
        </div>
      </main>
    </div>
  );
}
