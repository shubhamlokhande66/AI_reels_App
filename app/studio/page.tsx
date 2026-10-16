"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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

  return (
    <>
      {failed && <p className="m-4 rounded-lg border border-danger p-3 text-sm text-danger">Fast Studio could not start: {failed}</p>}
      <div ref={root} className="brs" dangerouslySetInnerHTML={{ __html: STUDIO_HTML }} />

      {/* the menu: the studio's settings (view, theme) and every page of the app */}
      <div className={`fixed inset-0 z-50 ${menu ? "" : "pointer-events-none"}`} aria-hidden={!menu}>
        <div className={`absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${menu ? "opacity-100" : "opacity-0"}`} onClick={() => setMenu(false)} />
        <aside
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          className={`absolute inset-y-0 left-0 flex w-[86%] max-w-sm flex-col border-r border-border bg-background shadow-2xl transition-transform duration-300 ease-out ${
            menu ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-[max(1.1rem,env(safe-area-inset-top))]">
            <Link href="/" className="flex items-center gap-3" onClick={() => setMenu(false)}>
              <span className="lux-btn-gold grid h-10 w-10 place-items-center rounded-full font-display text-lg font-bold">R</span>
              <span className="leading-tight">
                <span className="block font-display text-xl font-semibold tracking-wide">Reel Maison</span>
                <span className="block text-xs text-muted">
                  {me.data?.user?.email ?? "Fast Studio"}
                  {credits ? ` · ${credits.balance} credits` : ""}
                </span>
              </span>
            </Link>
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMenu(false)}
              className="grid h-11 w-11 place-items-center rounded-full border border-border transition-colors hover:border-accent/60 hover:text-accent"
            >
              ✕
            </button>
          </div>
          <a href="/studio" className="lux-btn-gold mx-5 mb-2 mt-1 flex h-12 items-center justify-center rounded-2xl text-[15px] font-bold">
            + New Reel
          </a>
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">Open my Reels in</p>
              <Seg label="View" items={VIEWS.map((x) => ({ key: x.v, label: x.label }))} value={view} onPick={(v) => viewsApi.current?.setView(v)} />
            </div>
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">Theme</p>
              <Seg label="Theme" items={THEMES.map((x) => ({ key: x.t, label: x.label }))} value={theme} onPick={pickTheme} />
            </div>
            <div className="lux-hairline" />
            <nav aria-label="Pages" className="-mx-2 space-y-5">
              <NavGroups groups={groups} pathname={pathname} onNavigate={() => setMenu(false)} />
            </nav>
          </div>
        </aside>
      </div>
    </>
  );
}
