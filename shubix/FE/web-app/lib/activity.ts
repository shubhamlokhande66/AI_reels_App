/** How many actions (non-GET requests and uploads) are on their way to the server right now; the GlobalActivity bar
 * shows while this is above zero, so every click that does something gives visible feedback.
 * The button that started an action shows a spinner inside it until the action is done: the last button clicked (a
 * moment ago) gets aria-busy="true" while its requests run (styled in app/globals.css), with no code in each page. */
let count = 0;
const listeners = new Set<() => void>();
const CLICK_MS = 1500;
let lastClick: { el: HTMLElement; at: number } | null = null;
const busy = new Map<HTMLElement, number>();

if (typeof document !== "undefined") {
  document.addEventListener(
    "click",
    (e) => {
      const el = (e.target as Element | null)?.closest?.("button, [role=button], a.btn");
      lastClick = el instanceof HTMLElement ? { el, at: Date.now() } : null;
    },
    true,
  );
}

function claimButton(): HTMLElement | null {
  const c = lastClick;
  if (!c || Date.now() - c.at > CLICK_MS || !c.el.isConnected) return null;
  busy.set(c.el, (busy.get(c.el) ?? 0) + 1);
  c.el.setAttribute("aria-busy", "true");
  return c.el;
}
function releaseButton(el: HTMLElement | null) {
  if (!el) return;
  const n = (busy.get(el) ?? 1) - 1;
  if (n > 0) return void busy.set(el, n);
  busy.delete(el);
  el.removeAttribute("aria-busy");
}

export function subscribeActivity(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function activityCount() {
  return count;
}

export async function tracked<T>(work: Promise<T>): Promise<T> {
  count += 1;
  const button = claimButton();
  listeners.forEach((fn) => fn());
  try {
    return await work;
  } finally {
    count -= 1;
    releaseButton(button);
    listeners.forEach((fn) => fn());
  }
}
