"use client";

// The installable app (PWA): the service worker, and the browser's "install" offer kept for our own Install button.
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let offer: InstallEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export function subscribeInstall(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const canInstall = () => !!offer;
export const isStandalone = () =>
  installed ||
  (typeof window !== "undefined" &&
    (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true));
/** iPhone / iPad Safari: no install offer; people add it with Share → Add to Home Screen. */
export const isIos = () => typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);

export async function install(): Promise<boolean> {
  if (!offer) return false;
  const e = offer;
  offer = null;
  emit();
  await e.prompt();
  return (await e.userChoice).outcome === "accepted";
}

let started = false;
/** Once per page load: register the service worker and listen for the install offer. */
export function startPwa() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // shown by our own button instead of the browser's mini bar
    offer = e as InstallEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    offer = null;
    emit();
  });
  if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
    window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined), { once: true });
    if (document.readyState === "complete") void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }
}
