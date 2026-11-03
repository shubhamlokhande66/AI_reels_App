// The app's pages, for the website's frame (FE/web-app/components/templates/AppShell.tsx) and the phone app's
// (Shared/ui-mobile frame): the menu groups, the bottom tabs, and what the phone top bar shows on each page.
// `tk`: the text key of a name (Admin → CMS, lib/texts.ts); the admin pages keep their own names.

export type NavItem = { href: string; label: string; tk?: string; icon: string; fullLoad?: boolean };
export type NavGroup = { title: string; tk?: string; admin?: boolean; items: NavItem[] };
export type NavTab = { href: string; label: string; tk: string; icon: string; primary?: boolean; full?: boolean };
export type PageMeta = { title: string; tk?: string; back?: string; left?: boolean; credits?: boolean; tabs?: boolean; admin?: boolean };

export const GROUPS: NavGroup[] = [
  {
    title: "Studio",
    tk: "nav.studio",
    items: [
      { href: "/", label: "Home", tk: "nav.home", icon: "home" },
      // the Create flow, one link per kind; a full page load on the website: it is cross-origin isolated
      // (next.config.ts) so its AI beat tracker can use several cores
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

// the phone's bottom bar: Home, Templates, Create, My Reels and Account (your whole account at a tap, as most apps do;
// the menu opens from the top bar)
export const TABS: NavTab[] = [
  { href: "/", label: "Home", tk: "nav.home", icon: "home" },
  { href: "/templates", label: "Templates", tk: "nav.templates", icon: "grid" },
  { href: "/create/music", label: "Create", tk: "nav.create", icon: "plus", primary: true, full: true },
  { href: "/reels", label: "My Reels", tk: "nav.reels", icon: "reels" },
  { href: "/account", label: "Account", tk: "nav.account", icon: "user" },
];

/** Pages shown on their own (no bars), and pages open before signing in. */
export const AUTH_PAGES = ["/login", "/forgot", "/reset", "/verify"];
export const PUBLIC_PAGES = ["/about", "/pricing", "/terms", "/privacy", "/refunds", "/delete-account", "/contact", "/editor"];

export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/projects") return pathname === "/projects" || (pathname.startsWith("/projects/") && pathname !== "/projects/new");
  return pathname === href || pathname.startsWith(`${href}/`);
}

const LEGAL: PageMeta = { title: "Legal", tk: "nav.legal", back: "/" };
const PAGES: Record<string, PageMeta> = {
  "/": { title: "Shubix", credits: true, tabs: true },
  "/reels": { title: "My Reels", tk: "nav.reels", credits: true, tabs: true },
  "/create/story": { title: "Story Maker", tk: "nav.story", back: "/", credits: true },
  "/create/edit": { title: "Your Reel", tk: "nav.yourReel", credits: true },
  "/editor": { title: "Reel Studio", credits: true },
  // the flow has its own back (FE/web-app/components/studio/flow.ts)
  "/create/music": { title: "Music Reel", tk: "nav.music", credits: true },
  "/create/talking": { title: "Talking Reel", tk: "nav.talking", credits: true },
  "/create/photo": { title: "Photo Reel", tk: "nav.photo", credits: true },
  "/templates": { title: "Templates", tk: "nav.templates" },
  "/brands": { title: "My Brands", tk: "nav.myBrands" },
  "/account": { title: "My account", tk: "nav.myAccount" },
  "/rewards": { title: "Invite & earn", tk: "nav.rewards" },
  "/pricing": { title: "Pricing & plans", tk: "nav.pricing", credits: true },
  "/credits": { title: "Your credits", tk: "pricing.yourCredits", credits: true },
  "/terms": LEGAL,
  "/privacy": LEGAL,
  "/refunds": LEGAL,
  "/delete-account": LEGAL,
  "/contact": { title: "Contact us", tk: "nav.contact" },
  "/settings": { title: "AI settings", admin: true },
  "/voices": { title: "Voice profiles", tk: "nav.voices" },
  "/trends": { title: "My trends", admin: true },
  "/admin": { title: "Administration" },
};

/** What the phone top bar shows on each page (the designs). */
export const pageMeta = (pathname: string): PageMeta => PAGES[pathname] ?? { title: "Shubix" };

/** Phones: the bottom tab bar on every page but the studio (/create/…, /editor, which keeps the whole screen for its
 * own tool bars) and the admin pages. */
export const isStudio = (pathname: string) => pathname.startsWith("/create") || pathname === "/editor";
export const showTabs = (pathname: string) => { const meta = pageMeta(pathname); return !!meta.tabs || (!isStudio(pathname) && !meta.admin); };
