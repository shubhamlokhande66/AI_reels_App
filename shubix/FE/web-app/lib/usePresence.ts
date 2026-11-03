"use client";

import { useEffect } from "react";
import { api } from "@/lib/api";
import { isStandalone } from "@/lib/pwa";

/** "Online now" on the admin dashboard: while the page is visible, this browser says it is here once every 5 minutes at
 * most (a new page or a tab shown again sends nothing sooner). Cloudflare answers this heartbeat at the edge whenever
 * the API container is asleep, so an idle tab never wakes or keeps the paid container running. A heartbeat is forwarded
 * only when the API is already ready. One id per browser, kept on this device, so several tabs count as one visitor. */
const KEY = "reel-visitor", EVERY_MS = 5 * 60_000;

function visitorId(): string {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/[^A-Za-z0-9_-]/g, "");
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return "anon-session"; // private mode: still counted, just not told apart
  }
}

const last = { path: "", at: 0 };
export function usePresence(pathname: string) {
  useEffect(() => {
    if (!pathname) return; // not a visitor (the phone app's hidden studio)
    const beat = () => {
      // once every 5 minutes at most: enough to count an active visitor without waking an idle API container
      if (document.visibilityState !== "visible") return;
      const now = Date.now(); if (now - last.at < EVERY_MS - 5000) return; last.path = pathname; last.at = now;
      // app: opened from the home screen (an iPhone's Safari then knows the app is installed: InstallBanner)
      if (document.visibilityState === "visible") api.ping(visitorId(), pathname, isStandalone()).catch(() => {}); // never in anyone's way
    };
    beat();
    const t = setInterval(beat, EVERY_MS);
    document.addEventListener("visibilitychange", beat);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [pathname]);
}
