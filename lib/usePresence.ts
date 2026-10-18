"use client";

import { useEffect } from "react";
import { api } from "@/lib/api";

/** "Online now" on the admin dashboard: while the page is visible, this browser says it is here about every 30 s (and on
 * each new page). One id per browser, kept on this device, so several tabs count as one visitor. */
const KEY = "reel-visitor", EVERY_MS = 30_000;

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

export function usePresence(pathname: string) {
  useEffect(() => {
    const beat = () => {
      if (document.visibilityState === "visible") api.ping(visitorId(), pathname).catch(() => {}); // never in anyone's way
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
