"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { BottomNav, type NavTab } from "@/components/molecules/BottomNav";
import { ProPill } from "@/components/molecules/ProPill";
import { CreditPill } from "@/components/molecules/CreditPill";
import { Avatar } from "@/components/atoms/Avatar";
import { Badge } from "@/components/atoms/Badge";
import { Eyebrow } from "@/components/atoms/Eyebrow";
import { IconButton } from "@/components/atoms/IconButton";
import { cn } from "@/lib/cn";
import { LockBadge } from "@/components/molecules/LockBadge";
import { NoticeCard } from "@/components/molecules/NoticeCard";
import { Card } from "@/components/atoms/Card";
import { ProBanner } from "@/components/molecules/ProBanner";
import { Button } from "@/components/atoms/Button";
import { Spinner } from "@/components/atoms/Spinner";
import { DesktopHeader } from "@/components/organisms/DesktopHeader";
import { NotificationBell } from "@/components/molecules/NotificationBell";
import { InstallApp } from "@/components/molecules/InstallApp";
import { StoreBadges } from "@/components/molecules/StoreBadges";
import { HelpChat } from "@/components/organisms/HelpChat";
import { InstallBanner } from "@/components/molecules/InstallBanner";
import { VerifyBanner } from "@/components/molecules/VerifyBanner";
import { captureRef } from "@/lib/marketing";
import { OfferStrip } from "@/components/molecules/OfferStrip";
import { TOP_SLOT, useCustomTitle } from "@/components/templates/TopBar";
import { useAdmin, useCredits, useFeatures, useLockCheck, useMe, useT } from "@/hooks/useApi";
import { lockTag, PAGE_LOCK } from "@/lib/plan-locks";
import { usePresence } from "@/lib/usePresence";
import { useErrorReport } from "@/lib/useErrorReport";
import { FEATURE_LIST, linkOn, pageFeature } from "@/lib/features-list";

// The app's frame, as designed: a Noir sidebar on computers; on phones a top bar (menu or back · title · credits),
// a bottom tab bar on Home, Projects and Editor, and a Noir menu drawer. An administrator sees one Admin dashboard
// button (server/core/admin.ts decides who); the admin tools below are listed in the dashboard, not in the menu.
// `tk`: the text key of a name (Admin → CMS, lib/texts.ts); the admin pages keep their own names
export const GROUPS: { title: string; tk?: string; admin?: boolean; items: { href: string; label: string; tk?: string; icon: string; fullLoad?: boolean }[] }[] = [
  {
    title: "Studio",
    tk: "nav.studio",
    items: [
      { href: "/", label: "Home", tk: "nav.home", icon: "home" },
      // the Create flow, one link per kind; a full page load: it is cross-origin isolated (next.config.ts) so its AI beat
      // tracker can use several cores
      { href: "/create/music", label: "Music Reel", tk: "nav.music", icon: "music", fullLoad: true },
      { href: "/create/talking", label: "Talking Reel", tk: "nav.talking", icon: "mic", fullLoad: true },
      { href: "/create/photo", label: "Photo Reel", tk: "nav.photo", icon: "image", fullLoad: true },
      { href: "/create/copy", label: "Copy a Reel", tk: "nav.copy", icon: "copy", fullLoad: true },
      { href: "/create/story", label: "Story Maker", tk: "nav.story", icon: "book", fullLoad: true },
      { href: "/reels", label: "My Reels", tk: "nav.reels", icon: "reels" },
    ],
  },
  {
    title: "Library",
    tk: "nav.library",
    items: [
      { href: "/templates", label: "Templates", tk: "nav.templates", icon: "grid" },
      { href: "/brands", label: "Brands", tk: "nav.brands", icon: "star" },
      { href: "/voices", label: "Voice profiles", tk: "nav.voices", icon: "mic" }, // Pro (lib/plan-locks.ts page:voices)
    ],
  },
  {
    title: "Account",
    tk: "nav.account",
    items: [
      { href: "/account", label: "My account", tk: "nav.myAccount", icon: "user" },
      { href: "/pricing", label: "Pricing & plans", tk: "nav.pricing", icon: "coins" },
      { href: "/rewards", label: "Invite & earn", tk: "nav.rewardsLink", icon: "gift" },
    ],
  },
  {
    title: "Admin",
    admin: true,
    items: [
      { href: "/settings", label: "AI settings", icon: "gear" },
      { href: "/trends", label: "My trends", icon: "trend" },
    ],
  },
];

const AUTH_PAGES = ["/login", "/forgot", "/reset", "/verify"];
const PUBLIC_PAGES = ["/pricing", "/terms", "/privacy", "/refunds", "/contact"];
const PARTNER_PAGE = "/affiliate"; // the partner dashboard: its own page, with its own sign-in (by an emailed code)

export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/projects") return pathname === "/projects" || (pathname.startsWith("/projects/") && pathname !== "/projects/new");
  return pathname === href || pathname.startsWith(`${href}/`);
}

type Meta = { title: string; tk?: string; back?: string; left?: boolean; credits?: boolean; tabs?: boolean; admin?: boolean };

/** What the phone top bar shows on each page (the designs). */
function pageMeta(p: string): Meta {
  const fixed: Record<string, Meta> = {
    "/": { title: "Shubix", credits: true, tabs: true },
    "/reels": { title: "My Reels", tk: "nav.reels", credits: true, tabs: true },
    "/create/story": { title: "Story Maker", tk: "nav.story", back: "/", credits: true },
    "/create/edit": { title: "Your Reel", tk: "nav.yourReel", credits: true },
    "/create/music": { title: "Music Reel", tk: "nav.music", credits: true }, // the flow has its own back (components/studio/flow.ts)
    "/create/talking": { title: "Talking Reel", tk: "nav.talking", credits: true }, // the flow has its own back (components/studio/flow.ts)
    "/create/photo": { title: "Photo Reel", tk: "nav.photo", credits: true }, // the flow has its own back (components/studio/flow.ts)
    "/templates": { title: "Templates", tk: "nav.templates" },
    "/brands": { title: "My Brands", tk: "nav.myBrands" },
    "/account": { title: "My account", tk: "nav.myAccount" },
    "/rewards": { title: "Invite & earn", tk: "nav.rewards" },
    "/pricing": { title: "Pricing & plans", tk: "nav.pricing", credits: true },
    "/terms": { title: "Legal", tk: "nav.legal", back: "/" },
    "/privacy": { title: "Legal", tk: "nav.legal", back: "/" },
    "/refunds": { title: "Legal", tk: "nav.legal", back: "/" },
    "/contact": { title: "Contact us", tk: "nav.contact" },
    "/settings": { title: "AI settings", admin: true },
    "/voices": { title: "Voice profiles", tk: "nav.voices" },
    "/trends": { title: "My trends", admin: true },
    "/admin": { title: "Administration" },
  };
  return fixed[p] ?? { title: "Shubix" };
}

/** A page on a higher plan (lib/plan-locks.ts "page:…"): its tag ("Upgrade"), or "". */
function useNavLock() {
  const check = useLockCheck();
  return (href: string) => { const need = PAGE_LOCK[href] && check ? check(PAGE_LOCK[href]) : ""; return need ? lockTag(need) : ""; };
}

/** The sidebar's and the drawer's page list. */
export function NavGroups({ groups, pathname, onNavigate }: { groups: typeof GROUPS; pathname: string; onNavigate?: () => void }) {
  const lockOf = useNavLock(), t = useT();
  return (
    <>
      {groups.map((g) => (
        <div key={g.title} className="flex flex-col gap-0.5">
          <Eyebrow className="px-2.5 pb-1 pt-3 first:pt-1">{g.tk ? t(g.tk) : g.title}</Eyebrow>
          {g.items.map((item) => {
            const active = isActive(pathname, item.href), lock = lockOf(item.href);
            const Tag = item.fullLoad && !lock ? "a" : Link;
            return (
              <Tag
                key={item.href}
                href={lock ? "/pricing?need=" + encodeURIComponent(item.href) : item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-[40px] items-center gap-3 rounded-[10px] px-2.5 text-[13.5px] transition-colors ${
                  active ? "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] font-bold text-foreground" : "text-muted hover:bg-[color-mix(in_srgb,var(--accent)_6%,transparent)] hover:text-foreground"
                }`}
              >
                <Icon name={item.icon} size={18} stroke={1.7} color={active ? "var(--accent)" : undefined} />
                <span className="min-w-0 truncate">{item.tk ? t(item.tk) : item.label}</span>
                {lock && <LockBadge />}
              </Tag>
            );
          })}
        </div>
      ))}
    </>
  );
}

/** Phones: the Noir drawer with every page (design: Menu). */
/** Only an administrator sees it: opens the admin dashboard (its daily code first, when due). */
export function AdminButton({ onClick }: { onClick?: () => void }) {
  return (
    <Button href="/admin" onClick={onClick} variant="secondary" icon="admin" full className="!border-accent/70 text-accent">
      Admin dashboard
    </Button>
  );
}

function Drawer({ open, onClose, groups, pathname, admin, email, credits, onSignOut }: {
  open: boolean;
  onClose: () => void;
  groups: typeof GROUPS;
  pathname: string;
  admin: boolean;
  email?: string;
  credits: { balance: number; planName: string } | null;
  onSignOut?: () => void;
}) {
  // the computer's sidebar list, by group (Studio, Library, Account with Pricing & plans), then the Admin dashboard button
  const main = groups.filter((g) => !g.admin);
  const lockOf = useNavLock(), t = useT();
  const link = (item: (typeof GROUPS)[number]["items"][number]) => {
    const active = isActive(pathname, item.href), lock = lockOf(item.href);
    const Tag = item.fullLoad && !lock ? "a" : Link;
    return (
      <Tag
        key={item.href}
        href={lock ? "/pricing?need=" + encodeURIComponent(item.href) : item.href}
        onClick={onClose}
        aria-current={active ? "page" : undefined}
        className={cn("flex min-h-[44px] items-center gap-2.5 rounded-xl px-2.5", active && "bg-accent/12 font-bold")}
      >
        <Icon name={item.icon} size={20} stroke={1.7} color={active ? "var(--accent)" : "var(--muted)"} />
        <span className="min-w-0 truncate">{item.tk ? t(item.tk) : item.label}</span>
        {lock && <LockBadge />}
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
        <div className="grid items-center gap-2 border-b border-border bg-[var(--bar)] px-4 pb-2.5 pt-[max(12px,env(safe-area-inset-top))] grid-cols-[1fr_44px]">
          <span className="flex min-w-0 items-center">
            <Logo height={44} />
          </span>
          <IconButton icon="close" plain label={t("common.closeMenu")} onClick={onClose} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-4 pt-3 [&>*]:shrink-0">
          {email && (
            <div className="flex items-center gap-3 px-1 pb-2.5 pt-1">
              <Avatar email={email} />
              <span className="truncate text-[12.5px] text-muted">{email}</span>
            </div>
          )}
          <nav aria-label="Pages" className="flex flex-col">
            {main.map((g) => (
              <div key={g.title} className="flex flex-col">
                <Eyebrow className="px-2.5 pb-1 pt-3 first:pt-1">{g.tk ? t(g.tk) : g.title}</Eyebrow>
                {g.items.map(link)}
              </div>
            ))}
          </nav>
          <div className="flex-1" />
          {admin && <AdminButton onClick={onClose} />}
          <ThemeToggle className="mt-2" />
          <InstallApp className="px-1 pt-2" />
          <StoreBadges compact className="px-1 pt-2" />
          {credits && (
            <div className="flex items-center justify-between gap-3 px-1 py-2.5">
              <span onClick={onClose}>
                <CreditPill balance={credits.balance} full />
              </span>
              <span className="text-[12.5px] text-muted">{t("nav.planSuffix", { plan: credits.planName })}</span>
            </div>
          )}
          {onSignOut && (
            <button type="button" onClick={onSignOut} className="flex min-h-[44px] items-center gap-3 px-1 text-left text-[12.5px] text-muted hover:text-foreground">
              <Icon name="signout" size={18} />
              {t("nav.signOut")}
            </button>
          )}
          <div className="pb-[env(safe-area-inset-bottom)]" />
        </div>
      </aside>
    </div>
  );
}

// Create opens Fast Studio when the server's Create Reel is off (Administration -> Features); at most four tabs and More
// (the design's order: Home, Templates, Create, My Reels, More)
const TABS: (NavTab & { tk: string })[] = [
  { href: "/", label: "Home", tk: "nav.home", icon: "home" },
  { href: "/templates", label: "Templates", tk: "nav.templates", icon: "grid" },
  { href: "/create/music", label: "Create", tk: "nav.create", icon: "plus", primary: true, full: true },
  { href: "/reels", label: "My Reels", tk: "nav.reels", icon: "reels" },
];
const tabsFor = (f: Parameters<typeof linkOn>[1]) => TABS.filter((t) => linkOn(t.href, f));

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const { admin, otp, loading } = useAdmin();
  const adminLink = admin || otp; // an admin account whose daily code is due: its button leads to the code
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const t = useT();
  const [drawer, setDrawer] = useState(false);
  const creditsQ = useCredits();
  const credits = creditsQ.data?.enabled ? creditsQ.data : null;
  const paid = !!credits && credits.plan !== "free";
  const [needCredits, setNeedCredits] = useState<string | null>(null);
  const customTitle = useCustomTitle();
  usePresence(pathname); // "online now" on the admin dashboard
  useEffect(() => { captureRef(); }, []); // a friend's invite link (?ref=username): kept for the sign-up
  const offer = useQuery({ queryKey: ["offer"], queryFn: api.offer, staleTime: 60_000 }).data?.offer ?? null; // a sale running: a slim bar
  useErrorReport(); // errors on people's phones reach Admin → Errors

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
  const partnerPage = pathname === PARTNER_PAGE;
  const publicPage = partnerPage || PUBLIC_PAGES.includes(pathname); // open to everyone, also before signing in
  const signedOut = !!me.data?.authEnabled && !me.data.user;
  useEffect(() => {
    if (signedOut && !authPage && !publicPage) router.replace("/login"); // accounts on and nobody signed in: the sign-in page
  }, [signedOut, authPage, publicPage, router]);
  // an admin page opened by address in user mode: say so instead of showing it (the server guards its data too)
  const adminPage = GROUPS.some((g) => g.admin && g.items.some((i) => isActive(pathname, i.href)));
  const blocked = adminPage && !admin && !loading;
  // a part of the app the administrator turned off: hidden from the menus; its page says so (the admin still sees it)
  const features = useFeatures();
  const offKey = pageFeature(pathname, features);
  const off = offKey && !features[offKey] ? FEATURE_LIST.find((f) => f.key === offKey)! : null;
  if ((pathname.startsWith("/admin") || pathname.startsWith("/cms")) && !signedOut) {
    // the admin dashboard is its own full-screen panel (its sidebar: Overview, Users, Settings, Tools)
    return (
      <main className="rm min-h-screen">
        <GlobalActivity />
        <ConfirmHost />
        {children}
      </main>
    );
  }
  if (partnerPage) {
    // the affiliate partner dashboard stands alone: partners who never use the studio see only it
    return (
      <main className="rm min-h-screen">
        <GlobalActivity />
        <ConfirmHost />
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
        {authPage && <HelpChat raised={false} />}
      </main>
    );
  }

  const groups = GROUPS.filter((g) => !g.admin)
    .map((g) => ({ ...g, items: g.items.filter((i) => linkOn(i.href, features)) }))
    .filter((g) => g.items.length); // a heading whose parts are all off is not shown
  const signOut = me.data?.user
    ? async () => {
        await api.logout();
        await qc.invalidateQueries();
        router.replace("/login");
      }
    : undefined;
  const meta = pageMeta(pathname);
  const title = customTitle ?? (meta.tk ? t(meta.tk) : meta.title);
  const back = meta.back;
  // phones: the bottom tab bar, the plan pill and the bell on every page; the studio (/create/…) keeps the whole screen
  // for its own tool bars, and the admin pages keep their Admin badge
  const studio = pathname.startsWith("/create");
  const tabs = meta.tabs || (!studio && !meta.admin);

  return (
    <div className="rm min-h-screen md:flex">
      <GlobalActivity />
      <ConfirmHost />
      <HelpChat raised={tabs} />

      {/* phones: the top bar */}
      <header className="grid items-center gap-2 border-b border-border bg-[var(--bar)] px-4 pb-2.5 pt-[max(12px,env(safe-area-inset-top))] sticky top-0 z-30 grid-cols-[44px_1fr_minmax(44px,auto)] md:hidden">
        {back ? (
          <IconButton icon="back" plain label={t("common.back")} onClick={() => (window.history.length > 1 ? router.back() : router.push(back))} />
        ) : (
          <IconButton icon="menu" plain iconSize={22} label={t("common.openMenu")} aria-expanded={drawer} onClick={() => setDrawer(true)} />
        )}
        <span className={cn("min-w-0 truncate whitespace-nowrap font-[family-name:var(--font-display)] text-[16px] font-semibold tracking-[-0.01em]", meta.left || pathname === "/" ? "text-left" : "text-center")}>{pathname === "/" ? <Logo height={44} /> : title}</span>
        <span className="flex items-center justify-end gap-2 [&:has(#rm-top-action:not(:empty))>.dflt]:hidden">
          <span id={TOP_SLOT} className="contents" />
          <span className="dflt contents">
            {meta.admin ? (
              <Badge tone="brand">Admin</Badge>
            ) : !studio ? (
              <span className="flex items-center gap-1">
                <InstallBanner compact />
                <ProPill plan={credits?.planName} planId={credits?.plan} compact={pathname !== "/"} />
                <NotificationBell />
              </span>
            ) : meta.credits && credits ? (
              <CreditPill balance={credits.balance} />
            ) : null}
          </span>
        </span>
      </header>

      <Drawer
        open={drawer}
        onClose={() => setDrawer(false)}
        groups={groups}
        pathname={pathname}
        admin={adminLink}
        email={me.data?.user?.email}
        credits={credits}
        onSignOut={signOut}
      />

      {/* computers: the Noir sidebar */}
      <aside className="hidden border-r border-border text-foreground [background:var(--sidebar)] md:fixed md:inset-y-0 md:left-0 md:z-30 md:flex md:w-60 md:flex-col md:gap-4 md:overflow-y-auto md:px-4 md:py-[22px] [&>*]:shrink-0">
        <Link href="/" className="flex" aria-label="Shubix home">
          <Logo height={100} className="-mx-1 max-w-full" />
        </Link>
        <Button href="/create/music" reload icon="plus" full>
          {t("nav.newReel")}
        </Button>
        <nav aria-label="Main" className="flex flex-col">
          <NavGroups groups={groups} pathname={pathname} />
        </nav>
        <div className="flex-1" />
        {!paid && <ProBanner compact />}
        {adminLink && <AdminButton />}
        <ThemeToggle />
        <InstallApp />
        <StoreBadges compact />
        {credits && (
          <div className="flex items-center justify-between gap-3">
            <CreditPill balance={credits.balance} full />
            <span className="text-[11px] text-muted">{t("nav.planSuffix", { plan: credits.planName })}</span>
          </div>
        )}
        {me.data?.user && (
          <div className="flex items-center justify-between gap-3 text-[11px] text-muted">
            <span className="truncate" title={me.data.user.email}>
              {me.data.user.email}
            </span>
            <button type="button" className="shrink-0 font-bold hover:text-accent" onClick={signOut}>
              {t("nav.signOut")}
            </button>
          </div>
        )}
      </aside>

      {/* phones: the bottom tab bar */}
      {tabs && <BottomNav tabs={tabsFor(features).map((x) => ({ ...x, label: t(x.tk), active: isActive(pathname, x.href) }))} moreOpen={drawer} onMore={() => setDrawer(true)} />}

      {needCredits && (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-[rgba(5,4,4,.82)] p-5 backdrop-blur-sm" onClick={() => setNeedCredits(null)}>
          <NoticeCard dialog icon="coins" eyebrow={t("nav.credits")} title={t("plan.noCreditsTitle")} text={`${needCredits} ${t("plan.noCreditsText")}`} onClick={(e) => e.stopPropagation()}
            actions={<><Button href="/pricing" size="lg" onClick={() => setNeedCredits(null)}>{t("plan.noCreditsButton")}</Button><Button variant="secondary" full onClick={() => setNeedCredits(null)}>{t("plan.noCreditsLater")}</Button></>} />
        </div>
      )}

      <main className={`min-w-0 flex-1 px-4 pt-4 md:ml-60 md:px-8 md:pb-10 md:pt-5 ${tabs ? "pb-28" : "pb-10"}`}>
        <DesktopHeader email={me.data?.user?.email} credits={credits} admin={adminLink} onSignOut={signOut} />
        {/* "Get the Shubix app" until it is installed (not over the studio while a Reel is made) */}
        <div className="mx-auto w-full max-w-6xl">
          {back && (
            <button
              type="button"
              onClick={() => (window.history.length > 1 ? router.back() : router.push(back))}
              className="mb-2 hidden items-center gap-2 text-[12.5px] font-bold text-muted hover:text-accent md:inline-flex"
            >
              <Icon name="back" size={16} />
              {t("common.back")}
            </button>
          )}
          {blocked ? (
            <div className="mx-auto mt-10 flex max-w-sm justify-center">
              <NoticeCard dialog icon="shield" eyebrow={t("common.adminOnly")} title={t("common.adminTitle")} text={t("common.adminText")}
                actions={<div className="grid grid-cols-2 gap-2"><Button href="/" variant="secondary">{t("common.back")}</Button><Button href="/admin">{t("common.adminSignIn")}</Button></div>} />
            </div>
          ) : adminPage && loading ? (
            // an admin page waits for the admin check (its parts ask admin-only data: not before we know)
            <div className="mt-16 flex justify-center"><Spinner /></div>
          ) : off && !admin ? (
            <div className="mx-auto mt-6 max-w-md">
              <EmptyState icon="lock" title={t("common.offTitle", { page: off.label })} hint={t("common.offText")} action={<Button href="/">{t("common.backHome")}</Button>} />
            </div>
          ) : (
            <>
              {off && (
                <Card role="status" className="mb-3 text-[12.5px] text-warning">{t("common.offAdmin", { page: off.label })}</Card>
              )}
              {me.data?.user?.emailVerified === false && <VerifyBanner email={me.data.user.email} />}
              {offer && pathname !== "/pricing" && !pathname.startsWith("/create") && <OfferStrip offer={offer} bar />}
              {children}
            </>
          )}
          <LegalFooter className="mt-12 border-t border-border pt-5" />
        </div>
      </main>
    </div>
  );
}
