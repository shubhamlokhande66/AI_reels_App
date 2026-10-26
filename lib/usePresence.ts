"use client";

import { useEffect } from "react";
import { api } from "@/lib/api";
import { isStandalone } from "@/lib/pwa";

/** "Online now" on the admin dashboard: while the page is visible, this browser says it is here every 5 minutes (and on
 * each new page, and when the tab is shown again). Not more often: on Cloudflare every request keeps the app's container
 * awake (it sleeps 30 s after the last one), and a ping every 30 s from one open tab kept it running all day.
 * One id per browser, kept on this device, so several tabs count as one visitor. */
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
    const beat = () => {
      // the same page counted once (React may start the page twice; a tab coming back right away is not a new visit)
      if (document.visibilityState !== "visible") return;
      const now = Date.now(); if (last.path === pathname && now - last.at < 3000) return; last.path = pathname; last.at = now;
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
