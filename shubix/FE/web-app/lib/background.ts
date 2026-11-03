/**
 * Long work that goes on while the person is in another tab or app (an export, a clip's smooth copy, a conversion on the
 * server, the AI): browsers slow such a page down (timers once a second or less), may take its video decoder back, and a
 * phone may pause it. These helpers let that work notice it, wait for the page to come back, show its progress in the
 * tab's title, and tell the person with a notification when it is done while they are elsewhere.
 */

export const isHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

/** Every video and song on the page stops (the person went to another page, tab or app). Videos the studio decodes off
 * the page (its smooth copies) are not on it, so their work goes on. */
export function pauseAllMedia() {
  if (typeof document !== "undefined") document.querySelectorAll<HTMLMediaElement>("video, audio").forEach((m) => m.pause());
}

/** Resolves as soon as the page is visible again (at once when it is). */
export function whenVisible(): Promise<void> {
  if (!isHidden()) return Promise.resolve();
  return new Promise((resolve) => {
    const on = () => { if (!isHidden()) { document.removeEventListener("visibilitychange", on); resolve(); } };
    document.addEventListener("visibilitychange", on);
  });
}

/** A pause that ends early when the page comes back (polling while hidden: slow timers, then an immediate check). */
export function nap(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => { clearTimeout(t); document.removeEventListener("visibilitychange", vis); resolve(); };
    const vis = () => { if (!isHidden()) done(); };
    const t = setTimeout(done, ms);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", vis);
  });
}

/** The browser took the video decoder / encoder back from a page in the background (Chrome: "Codec reclaimed"). */
export function isReclaimed(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null;
  return !!e && (e.name === "QuotaExceededError" || /reclaim|background|inactiv/i.test(String(e.message || "")));
}

/* ---- progress in the tab's title, while the page is hidden ("(45%) Exporting · Shubix") ---- */
let baseTitle = "";
const jobs = new Map<string, { label: string; p: number | null }>();
function paintTitle() {
  if (typeof document === "undefined") return;
  if (!baseTitle) baseTitle = document.title;
  const last = [...jobs.values()].pop();
  if (!last || !isHidden()) { if (document.title !== baseTitle) document.title = baseTitle; return; }
  document.title = (last.p != null ? `(${Math.round(last.p * 100)}%) ` : "… ") + last.label + " · " + baseTitle;
}
if (typeof document !== "undefined") document.addEventListener("visibilitychange", paintTitle);
export function titleProgress(id: string, label: string, p: number | null) { jobs.set(id, { label, p }); paintTitle(); }
export function titleDone(id: string) { jobs.delete(id); paintTitle(); }

/* ---- a notification when long work ends while the person is elsewhere ---- */
const ASKED = "shubix-notify-asked";
/** Asked once, from a tap that starts long work (browsers allow the question only after a tap). */
export function askToNotify() {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "default" || localStorage.getItem(ASKED)) return;
    localStorage.setItem(ASKED, "1");
    void Notification.requestPermission().catch(() => undefined);
  } catch { /* storage or notifications not available */ }
}
/** Shown only when the page is hidden and notifications are allowed (else the page's own message is enough). */
export async function notifyDone(title: string, body: string, tag = "shubix-work") {
  try {
    if (!isHidden() || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const opts = { body, tag, icon: "/icon-192.png", badge: "/icon-192.png", data: { url: location.pathname + location.search } } as NotificationOptions;
    // Android Chrome shows notifications only through the service worker
    const reg = typeof navigator !== "undefined" && "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration().catch(() => undefined) : undefined;
    if (reg) await reg.showNotification(title, opts);
    else new Notification(title, opts);
  } catch { /* not allowed here */ }
}

/** Held while long work runs: a page holding a Web Lock is not frozen by Chrome in the background (best effort). */
export function holdAwake(): () => void {
  let release = () => {};
  try {
    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    if (!locks) return release;
    let free: () => void = () => {};
    const held = new Promise<void>((r) => { free = r; });
    void locks.request("shubix-long-work-" + Math.random().toString(36).slice(2), () => held).catch(() => undefined);
    release = () => free();
  } catch { /* no Web Locks */ }
  return release;
}
