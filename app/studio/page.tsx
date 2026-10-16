"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { STUDIO_HTML } from "@/components/studio/markup";
import { initViews, type StudioView } from "@/components/studio/views";
import { GROUPS, NavGroups } from "@/components/templates/AppShell";
import { useAdmin, useCredits, useMe } from "@/hooks/useApi";
import { applyTheme, themeChoice, type ThemeChoice } from "@/lib/theme";
import "@/components/studio/studio.css";

/**
 * Fast Studio: song + clips -> a finished, beat-synced Reel made entirely on this device (analysis, edit, GPU preview and a
 * WebCodecs MP4 export). Nothing is uploaded, so it is fast and costs no server time. The editor itself is plain DOM code
 * (components/studio/engine.ts) mounted into this page once; components/studio/views.ts switches its Simple / Editor /
 * Pro views. A full-screen workspace: its own top bar, and this menu instead of the app's sidebar.
 */

const SCRIPTS = ["/vendor/tracking/tracking-min.js", "/vendor/tracking/face-min.js"]; // face finder (BSD), loaded in order

function loadScript(src: string): Promise<void> {
  return new Promise((resolve) => {
    if (document.querySelector(`script[data-studio="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = false;
    s.dataset.studio = src;
    s.onload = () => resolve();
    s.onerror = () => resolve(); // faces are optional: the edit still works without them
    document.head.appendChild(s);
  });
}

// the menu's pages (as in the design): the studio's own first, then the rest of the app for admins
const ICON = (d: string) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const PAGES: { href: string; label: string; icon: string; full?: boolean }[] = [
  { href: "/", label: "Home", icon: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" },
  { href: "/projects", label: "My projects", icon: "M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 9h18" },
  { href: "/templates", label: "Templates", icon: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" },
  { href: "/studio?view=pro&tool=style", label: "Style library", icon: "M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z", full: true },
  { href: "/songs", label: "My music", icon: "M9 18V5l12-2v13M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" },
];
const FOOT: { href: string; label: string }[] = [
  { href: "/account", label: "Settings" },
  { href: "/contact", label: "Help & tips" },
  { href: "/pricing", label: "Pricing & credits" },
];

const VIEWS: { v: StudioView; label: string }[] = [
  { v: "simple", label: "Simple" },
  { v: "editor", label: "Editor" },
  { v: "pro", label: "Pro" },
];
const THEMES: { t: ThemeChoice; label: string }[] = [
  { t: "light", label: "Ivory" },
  { t: "dark", label: "Noir" },
  { t: "auto", label: "Auto" },
];

function Seg<T extends string>({ label, items, value, onPick }: { label: string; items: { key: T; label: string }[]; value: T; onPick: (k: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-3 gap-1 rounded-2xl border border-border bg-surface-2 p-1">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          role="radio"
          aria-checked={value === it.key}
          onClick={() => onPick(it.key)}
          className={`h-10 rounded-xl text-sm transition-colors ${value === it.key ? "bg-surface font-bold text-foreground shadow-sm" : "font-medium text-muted hover:text-foreground"}`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export default function FastStudioPage() {
  const root = useRef<HTMLDivElement>(null);
  const viewsApi = useRef<{ setView: (v: StudioView) => void } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [view, setView] = useState<StudioView>("simple");
  const [theme, setTheme] = useState<ThemeChoice>("auto");
  const [slots, setSlots] = useState<{ nav: HTMLElement; right: HTMLElement } | null>(null);
  const pathname = usePathname() ?? "/studio";
  const { admin } = useAdmin();
  const me = useMe();
  const creditsQ = useCredits();
  const credits = creditsQ.data?.enabled ? creditsQ.data : null;

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    const el = root.current!;
    const v = initViews(el, setView);
    // the desktop top bar's links and account corner are drawn here, into the studio's own top bar
    const nav = el.querySelector<HTMLElement>("#tbnav"), right = el.querySelector<HTMLElement>("#tbright");
    if (nav && right) queueMicrotask(() => setSlots({ nav, right }));
    viewsApi.current = v;
    const openMenu = () => {
      setTheme(themeChoice());
      setMenu(true);
    };
    el.querySelector("#menubtn")?.addEventListener("click", openMenu);
    (async () => {
      try {
        for (const src of SCRIPTS) await loadScript(src);
        const { initStudio } = await import("@/components/studio/engine");
        if (cancelled || !root.current) return;
        cleanup = initStudio(root.current, {
          loadMediabunny: () => import("mediabunny"),
          // AAC for the export on browsers whose WebCodecs has no AAC encoder (Safari before 26, i.e. most iPhones today)
          loadAacEncoder: () => import("@mediabunny/aac-encoder"),
          // the on-device AI beat tracker (Beat This!, ONNX Runtime WebAssembly, in a worker); loaded only when a song is
          beatThis: (mono: Float32Array, sr: number, onProgress?: (stage: "download" | "run", p: number) => void) =>
            import("@/lib/beatThis/client").then((m) => m.beatThisOnDevice(mono, sr, onProgress)),
          // where people speak in a clip (Silero VAD in a worker), for cutting the silences of talking videos
          speechProbs: (mono: Float32Array, sr: number) => import("@/lib/vad/client").then((m) => m.speechProbs(mono, sr)),
          // who is the person (background blur / replace, text behind the person) and where faces are (MediaPipe models)
          // voice noise cleanup (RNNoise, WebAssembly), loaded only for talking videos and voiceovers
          loadRnnoise: () => import("@shiguredo/rnnoise-wasm"),
          personMask: (rgba: Uint8ClampedArray) => import("@/lib/vision/client").then((m) => m.personMask(rgba)),
          findFaces: (squares: Uint8ClampedArray[]) => import("@/lib/vision/client").then((m) => m.findFaces(squares)),
        });
      } catch (e) {
        setFailed(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      el.querySelector("#menubtn")?.removeEventListener("click", openMenu);
      v.cleanup();
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  const pickTheme = (t: ThemeChoice) => {
    applyTheme(t);
    setTheme(t);
  };
  const groups = GROUPS.filter((g) => !g.admin || admin);

  const name = me.data?.user?.email?.split("@")[0] ?? "";
  const close = () => setMenu(false);
  const pageLink = (p: (typeof PAGES)[number], cls: string, onClick?: () => void) => {
    const active = p.href === pathname;
    const inner = (
      <>
        <span className={active ? "text-accent" : "text-muted"}>{ICON(p.icon)}</span>
        {p.label}
      </>
    );
    return p.full || p.href.startsWith("/studio") ? (
      <a key={p.href} href={p.href} className={cls} onClick={onClick}>
        {inner}
      </a>
    ) : (
      <Link key={p.href} href={p.href} className={cls} onClick={onClick} aria-current={active ? "page" : undefined}>
        {inner}
      </Link>
    );
  };

  return (
    <>
      {failed && <p className="m-4 rounded-lg border border-danger p-3 text-sm text-danger">Fast Studio could not start: {failed}</p>}
      <div ref={root} className="brs" dangerouslySetInnerHTML={{ __html: STUDIO_HTML }} />

      {/* computers: the top bar's links (as in the design) and the account corner */}
      {slots &&
        createPortal(
          <>
            {PAGES.map((p) => pageLink(p, "tbl"))}
          </>,
          slots.nav,
        )}
      {slots &&
        createPortal(
          <>
            {credits && (
              <Link href="/pricing" className="tbcred" title="Your credits: plans and top-ups">
                {credits.balance} credits
              </Link>
            )}
            <button
              type="button"
              className="ibtn"
              aria-label={theme === "dark" || (theme === "auto" && document.documentElement.dataset.theme === "dark") ? "Theme: switch to Ivory" : "Theme: switch to Noir"}
              onClick={() => {
                const next: ThemeChoice = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
                pickTheme(next);
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
              </svg>
            </button>
            <button type="button" className="tbavatar" aria-label="Menu" onClick={() => { setTheme(themeChoice()); setMenu(true); }}>
              {(name[0] || "R").toUpperCase()}
            </button>
          </>,
          slots.right,
        )}

      {/* the menu (as in the design): New Reel, the studio's pages, the view and theme, settings and help */}
      <div className={`fixed inset-0 z-50 ${menu ? "" : "pointer-events-none"}`} aria-hidden={!menu}>
        <div className={`absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${menu ? "opacity-100" : "opacity-0"}`} onClick={close} />
        <aside
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          className={`absolute inset-y-0 left-0 flex w-[82%] max-w-[320px] flex-col bg-background shadow-2xl transition-transform duration-300 ease-out ${
            menu ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-center gap-3 px-5 pb-4 pt-[max(1.4rem,env(safe-area-inset-top))]">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-accent font-display text-xl font-semibold text-background">R</span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block font-display text-[19px] font-semibold">Reel Maison</span>
              <span className="block truncate text-[12.5px] text-muted">
                {name || "Fast Studio"}
                {credits ? ` · ${credits.balance} credits` : ""}
              </span>
            </span>
            <button type="button" aria-label="Close menu" onClick={close} className="grid h-11 w-11 place-items-center rounded-full text-muted hover:text-foreground">
              ✕
            </button>
          </div>
          <a href="/studio" className="mx-3.5 bg-foreground text-background mb-2 flex h-12 items-center justify-center gap-2 rounded-[14px] text-[15px] font-bold">
            <span aria-hidden>+</span> New Reel
          </a>
          <div className="flex-1 overflow-y-auto">
            <nav aria-label="Pages" className="flex flex-col px-2 py-1.5">
              {PAGES.map((p) => pageLink(p, "flex h-[46px] items-center gap-3.5 rounded-xl px-3 text-[15px] hover:bg-surface-2 aria-[current=page]:bg-surface-2 aria-[current=page]:font-semibold", close))}
            </nav>
            <div className="mx-5 mt-2 border-t border-border" />
            <p className="px-5 pb-2 pt-3.5 text-xs font-bold uppercase tracking-[0.1em] text-muted">Open my Reels in</p>
            <div className="mx-3.5">
              <Seg label="Open my Reels in" items={VIEWS.map((x) => ({ key: x.v, label: x.label }))} value={view} onPick={(v) => viewsApi.current?.setView(v)} />
            </div>
            <p className="px-5 pb-2 pt-4 text-xs font-bold uppercase tracking-[0.1em] text-muted">Theme</p>
            <div className="mx-3.5">
              <Seg label="Theme" items={THEMES.map((x) => ({ key: x.t, label: x.label }))} value={theme} onPick={pickTheme} />
            </div>
            {admin && (
              <nav aria-label="All pages" className="mt-5 space-y-5 px-2">
                <NavGroups groups={groups} pathname={pathname} onNavigate={close} />
              </nav>
            )}
          </div>
          <div className="flex flex-col border-t border-border px-2 pb-[max(1.4rem,env(safe-area-inset-bottom))] pt-2">
            {FOOT.map((f) => (
              <Link key={f.href} href={f.href} onClick={close} className="flex h-11 items-center rounded-xl px-3 text-[14.5px] hover:bg-surface-2">
                {f.label}
              </Link>
            ))}
          </div>
        </aside>
      </div>
    </>
  );
}
