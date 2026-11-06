/**
 * What Fast Studio is doing right now, in a popup at the centre of the screen; the page behind it is frozen until the work
 * is over: one card per process (adding the song, checking the beats, reading the clips, AI, captions, export, saving to
 * My Reels) with a small live animation for its kind instead of a spinner, the step in plain words, a progress bar and the
 * time left. A failure becomes a message with OK (Toaster). In the Create flow its Cancel and Cancel Reel stop the work
 * (setGuard); once the AI has answered they are off (lock); elsewhere the popup can be hidden after a while. On a phone the
 * export has its own screen (flow.ts). Styled with Tailwind (animations: app/globals.css @theme).
 * Each change is also told to the page as a "studio-task" event on the host ({ id, kind, state, p, title }), so the
 * Create flow's "Analysing" screen (flow.ts) shows the same progress.
 */

import { tx } from "./i18n";
import { Button } from "./ui";

export type TaskEvent = { id: string; kind?: TaskKind; state: "start" | "progress" | "done" | "fail" | "clear"; p: number | null; title?: string; detail?: string };

export type TaskKind = "music" | "clips" | "ai" | "export" | "cloud" | "voice";
type Card = { el: HTMLElement; kind: TaskKind; t0: number; p: number | null; timer?: ReturnType<typeof setTimeout> };

const ICON: Record<TaskKind, string> = {
  // equaliser bars, moving like music
  music: `<span class="flex h-5 items-end gap-[3px]" aria-hidden="true">${[0, -0.35, -0.15, -0.55]
    .map((d) => `<i class="block h-5 w-[3px] origin-bottom rounded-full bg-current motion-safe:animate-eq" style="animation-delay:${d}s"></i>`)
    .join("")}</span>`,
  // a film strip running past
  clips: `<span class="relative block h-[22px] w-[26px] overflow-hidden rounded-[5px] border-2 border-current" aria-hidden="true"><i class="absolute inset-x-0 top-0 h-[4px] bg-[repeating-linear-gradient(90deg,currentColor_0_3px,transparent_3px_7px)] motion-safe:animate-film"></i><i class="absolute inset-x-0 bottom-0 h-[4px] bg-[repeating-linear-gradient(90deg,currentColor_0_3px,transparent_3px_7px)] motion-safe:animate-film"></i></span>`,
  // a sparkle, breathing
  ai: `<svg class="motion-safe:animate-spark" width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8zM19 15l.9 2.6L22.5 18.5l-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9z"/></svg>`,
  // a ring that fills with the export
  export: `<svg width="30" height="30" viewBox="0 0 36 36" class="-rotate-90" aria-hidden="true"><circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" stroke-opacity=".2" stroke-width="4"/><circle data-ring cx="18" cy="18" r="15" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-dasharray="94.25" stroke-dashoffset="94.25" class="transition-[stroke-dashoffset] duration-300"/></svg>`,
  // an arrow rising to the cloud
  cloud: `<svg class="motion-safe:animate-rise" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V6M6 11l6-6 6 6"/></svg>`,
  // a microphone with a ring around it
  voice: `<span class="relative grid place-items-center" aria-hidden="true"><i class="absolute h-7 w-7 rounded-full border-2 border-current opacity-60 motion-safe:animate-ping"></i><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/></svg></span>`,
};
const TICK = `<svg class="motion-safe:animate-pop" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;

// what the Create flow's popup lists, in order (a task's id, its line)
const STEPS: [string, string][] = [["song", "Reading your song"], ["beats", "Checking every beat"], ["clips", "Preparing and analysing your clips"], ["ai", "Shubix AI editing your Reel"]];

const left = (s: number) => (s < 1.5 ? "almost done" : s < 60 ? `about ${Math.ceil(s)} s left` : `about ${Math.ceil(s / 60)} min left`);

export function createTasks(host: HTMLElement) {
  const cards = new Map<string, Card>();
  const box = document.createElement("div");
  box.setAttribute("aria-live", "polite"); box.dataset.tasks = "1"; box.hidden = true;
  box.className = "fixed inset-0 z-[90] grid place-items-center bg-black/70 px-4 backdrop-blur-md";
  box.innerHTML = `<div role="dialog" aria-modal="true" class="relative flex w-full max-w-[580px] flex-col gap-5 overflow-hidden rounded-[32px] border border-accent/30 bg-surface p-6 text-foreground sm:p-9 [@media(max-height:680px)]:gap-3 [@media(max-height:680px)]:p-5! shadow-[0_32px_90px_-24px_rgba(0,0,0,.75),0_0_70px_-28px_var(--accent)]"><i class="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-accent to-transparent"></i><div data-head hidden class="text-center"><p class="m-0 text-[12px] font-bold uppercase tracking-[.22em] text-accent" data-kicker></p><h2 class="m-0 mt-2 text-[26px] font-semibold leading-tight tracking-tight" data-big></h2><p class="m-0 mt-2 text-[14px] leading-[22px] text-muted [@media(max-height:680px)]:hidden" data-sub></p></div><div data-list class="flex flex-col gap-4"></div><ul data-steps hidden class="m-0 flex list-none flex-col gap-3 rounded-[20px] border border-border bg-foreground/[.03] p-4 sm:p-5 [@media(max-height:680px)]:gap-1.5 [@media(max-height:680px)]:p-3"></ul><p data-why hidden aria-live="off" class="m-0 min-h-[38px] text-center text-[12.5px] font-semibold leading-[19px] text-foreground"></p><div data-acts class="flex gap-2"></div></div>`;
  host.appendChild(box);
  host.addEventListener("studio-quiet", () => refresh());
  const head = box.querySelector<HTMLElement>("[data-head]")!, steps = box.querySelector<HTMLElement>("[data-steps]")!, doneSteps = new Set<string>();
  head.querySelector("[data-kicker]")!.textContent = tx("Shubix Studio");
  head.querySelector("[data-big]")!.textContent = tx("Crafting your Reel");
  head.querySelector("[data-sub]")!.textContent = tx("Every beat, every clip, every moment.");
  const paintSteps = () => {
    steps.textContent = "";
    const running = (id: string) => cards.has(id) && !doneSteps.has(id), last = STEPS.reduce((at, [id], i) => (running(id) ? i : at), -1);   // a step before the one running is behind us
    for (const [i, [id, words]] of STEPS.entries()) {
      const now = running(id), ok = doneSteps.has(id) || (!now && i < last), li = document.createElement("li");
      li.className = "flex items-center gap-3 text-[14px] " + (now ? "font-semibold text-foreground" : "text-muted");
      li.innerHTML = `<span class="grid h-6 w-6 shrink-0 place-items-center rounded-full ${ok ? "bg-success/15 text-success" : now ? "bg-accent/15 text-accent" : "border border-border"}">${ok ? TICK.replace(/width="22" height="22"/, 'width="14" height="14"') : now ? '<i class="block h-2 w-2 rounded-full bg-current motion-safe:animate-ping"></i>' : ""}</span><span></span>`;
      li.lastElementChild!.textContent = tx(words);
      steps.appendChild(li);
    }
  };
  const list = box.querySelector<HTMLElement>("[data-list]")!, why = box.querySelector<HTMLElement>("[data-why]")!, acts = box.querySelector<HTMLElement>("[data-acts]")!;
  // while the AI works: why to stay, one short line after another
  let notes: string[] = [], note = 0, noteTimer: ReturnType<typeof setInterval> | undefined;
  // the screen stays on while the AI works (where the browser allows it)
  let awake: { release: () => Promise<void> } | null = null, asking = false;
  // in another tab: a held lock keeps the browser from freezing this one, and a sound nobody can hear keeps its timers on time
  // (a phone's browser with its screen off may still stop the page: the words say so)
  let stayEnd: (() => void) | null = null, hum: AudioContext | null = null;
  const stayAlive = (on: boolean) => {
    if (!on) { stayEnd?.(); stayEnd = null; void hum?.close().catch(() => undefined); hum = null; return; }
    if (stayEnd) return;
    const held = new Promise<void>((done) => { stayEnd = done; });
    try { void (navigator as unknown as { locks?: { request(n: string, f: () => Promise<void>): Promise<void> } }).locks?.request("shubix-work", () => held).catch(() => undefined); } catch { /* an older browser */ }
    try {
      if (typeof AudioContext === "undefined") return;
      hum = new AudioContext(); const o = hum.createOscillator(), g = hum.createGain(); g.gain.value = 0.0001; o.connect(g); g.connect(hum.destination); o.start();
      void hum.resume().catch(() => undefined);
    } catch { /* no sound here: only the lock */ }
  };
  const stayAwake = async (on: boolean) => {
    if (!on) { const a = awake; awake = null; await a?.release().catch(() => undefined); return; }
    if (awake || asking) return;
    asking = true;
    try { const w = (navigator as unknown as { wakeLock?: { request(t: string): Promise<{ release: () => Promise<void> }> } }).wakeLock; if (w) awake = await w.request("screen"); } catch { /* not allowed now: the words still say to stay */ } finally { asking = false; }
  };
  const stopNotes = () => { clearInterval(noteTimer); noteTimer = undefined; void stayAwake(false); };
  let guard: { onCancel: () => void; onCancelReel: () => void } | null = null, locked = false, hideOk = false, hideTimer: ReturnType<typeof setTimeout> | undefined;
  const hiddenIds = new Set<string>();
  const onOwnScreen = (c: Card) => c.kind === "export" && window.matchMedia("(max-width: 1023px)").matches;
  const button = (cls: string, text: string, fn: () => void, off = false) => { const b = document.createElement("button"); b.type = "button"; b.className = cls + " min-w-0 flex-1"; b.textContent = text; b.disabled = off; b.onclick = fn; acts.appendChild(b); };
  // the popup shows while a process with no screen of its own runs
  function refresh() {
    const shown = [...cards].filter(([id, c]) => !onOwnScreen(c) && !hiddenIds.has(id));
    stayAlive(cards.size > 0);
    // one card, the newest: the popup never scrolls (the others are in its steps)
    const newest = shown[shown.length - 1]?.[0];
    cards.forEach((c, id) => { c.el.hidden = id !== newest; });
    // the Create flow's work before Generate goes on behind the page (flow.ts): each clip's card says how it goes
    const was = box.hidden; box.hidden = !shown.length || host.dataset.fquiet === "1";
    if (box.hidden) { stopNotes(); hiddenIds.clear(); hideOk = false; clearTimeout(hideTimer); return; }
    if (was) { hideOk = false; clearTimeout(hideTimer); hideTimer = setTimeout(() => { hideOk = true; refresh(); }, 30_000); }
    head.hidden = steps.hidden = !guard; if (guard) paintSteps();
    // what Shubix AI uses, under the popup's title, once Generate was pressed (flow.ts)
    head.querySelector("[data-sub]")!.textContent = host.dataset.fcredit || tx("Every beat, every clip, every moment.");
    notes = locked || shown.some(([, c]) => c.kind === "ai") ? [tx(window.matchMedia?.("(pointer: coarse)").matches ? "Keep this page open with the screen on." : "You can switch tabs. Keep this tab open."), tx("Closing it now may lose this Reel's credits."), ...(guard && locked ? [tx("Shubix AI has started working on this Reel. You can't cancel now.")] : [])] : [];
    why.hidden = !notes.length; if (notes.length) why.textContent = notes[note % notes.length];
    if (notes.length) void stayAwake(true);
    if (!notes.length) stopNotes(); else if (!noteTimer) noteTimer = setInterval(() => { why.textContent = notes[++note % notes.length]; }, 3500);
    acts.textContent = "";
    if (guard && locked) button(Button.secondary, tx("Cancel"), () => {}, true);
    else if (guard) { const g = guard; button(Button.secondary, tx("Cancel"), g.onCancel); button(Button.danger, tx("Cancel Reel"), g.onCancelReel); }
    else if (hideOk) button(Button.secondary, tx("Hide"), () => { cards.forEach((_, id) => hiddenIds.add(id)); refresh(); });
  }
  const emit = (e: TaskEvent) => host.dispatchEvent(new CustomEvent<TaskEvent>("studio-task", { detail: e }));

  function paint(c: Card, title?: string, detail?: string) {
    const q = <T extends Element>(s: string) => c.el.querySelector<T>(s)!;
    if (title !== undefined) q("[data-t]").textContent = title;
    if (detail !== undefined) q("[data-d]").textContent = detail;
    const bar = q<HTMLElement>("[data-bar]"), info = q("[data-i]");
    if (c.p === null) {
      bar.style.width = "40%";
      bar.classList.add("motion-safe:animate-slide");
      info.textContent = "";
    } else {
      const pc = Math.max(0, Math.min(1, c.p));
      bar.classList.remove("motion-safe:animate-slide");
      bar.style.width = `${(pc * 100).toFixed(1)}%`;
      const el = (performance.now() - c.t0) / 1000;
      info.textContent = `${Math.round(pc * 100)}%` + (pc > 0.04 && pc < 1 && el > 2 ? ` · ${left(el / pc - el)}` : "");
      const ring = c.el.querySelector<SVGCircleElement>("[data-ring]");
      if (ring) ring.style.strokeDashoffset = String(94.25 * (1 - pc));
    }
  }

  /** A process starts (or starts over): its card appears, or the existing one is reused. */
  function start(id: string, kind: TaskKind, title: string, detail = "") {
    let c = cards.get(id);
    if (c?.timer) clearTimeout(c.timer);
    if (!c || c.kind !== kind) {
      c?.el.remove();
      const el = document.createElement("div");
      el.setAttribute("role", "status");
      el.className =
        "flex w-full items-center gap-3 text-foreground";
      el.innerHTML = `<span data-ic class="grid h-14 w-14 shrink-0 place-items-center rounded-full border border-accent/30 bg-accent/10 text-accent">${ICON[kind]}</span>
        <span class="min-w-0 flex-1">
          <span class="flex items-baseline justify-between gap-2"><b data-t class="truncate text-[16px] font-semibold tracking-tight"></b><span data-i class="shrink-0 text-[11.5px] tabular-nums text-muted"></span></span>
          <span data-d class="block truncate text-[12.5px] text-muted"></span>
          <span class="mt-2.5 block h-1 overflow-hidden rounded-full bg-foreground/10"><i data-bar class="block h-full rounded-full bg-gradient-to-r from-accent/60 to-accent transition-[width] duration-300"></i></span>
        </span>`;
      list.appendChild(el);
      c = { el, kind, t0: performance.now(), p: null };
      cards.set(id, c);
    } else {
      c.t0 = performance.now();
      c.p = null;
      c.el.classList.remove("opacity-0", "translate-y-2");
      c.el.querySelector("[data-ic]")!.innerHTML = ICON[kind];
      c.el.querySelector("[data-ic]")!.className = "grid h-14 w-14 shrink-0 place-items-center rounded-full border border-accent/30 bg-accent/10 text-accent";
    }
    paint(c, title, detail);
    doneSteps.delete(id);
    refresh();
    emit({ id, kind, state: "start", p: null, title, detail });
  }

  /** Progress (0..1, or null when unknown) and the step in words. */
  function update(id: string, p: number | null, detail?: string, title?: string) {
    const c = cards.get(id);
    if (!c) return;
    c.p = p;
    paint(c, title, detail);
    emit({ id, kind: c.kind, state: "progress", p, title, detail });
  }

  function finish(id: string, ok: boolean, text: string, ms: number) {
    const c = cards.get(id);
    if (!c) return;
    if (!ok) {   // its reason, with OK (Toaster)
      if (c.timer) clearTimeout(c.timer);
      c.el.remove(); cards.delete(id); refresh();
      emit({ id, kind: c.kind, state: "fail", p: c.p, title: text });
      window.dispatchEvent(new CustomEvent("shubix-toast", { detail: { kind: "error", text } }));
      return;
    }
    doneSteps.add(id); if (guard) paintSteps();
    const ic = c.el.querySelector<HTMLElement>("[data-ic]")!;
    ic.innerHTML = TICK;
    ic.className = "grid h-14 w-14 shrink-0 place-items-center rounded-full border border-success/30 bg-success/10 text-success";
    c.p = 1;
    paint(c, undefined, text);
    emit({ id, kind: c.kind, state: ok ? "done" : "fail", p: c.p, title: text });
    if (ok) c.el.querySelector("[data-i]")!.textContent = "";
    c.timer = setTimeout(() => {
      c.el.classList.add("opacity-0", "translate-y-2");
      setTimeout(() => {
        c.el.remove();
        if (cards.get(id) === c) cards.delete(id);
        refresh();
      }, 120);
    }, ms);
  }

  return {
    start,
    update,
    /** Finished: a tick, then the card goes. */
    done: (id: string, text = "Done") => finish(id, true, text, 500),
    /** Did not work: its reason, with OK. */
    fail: (id: string, text: string) => finish(id, false, text, 0),
    /** How the work can be stopped while the Create flow is open. */
    setGuard: (g: { onCancel: () => void; onCancelReel: () => void } | null) => { if (guard === g) return; guard = g; if (cards.size) refresh(); },
    /** The AI has answered, its tokens are spent: nothing can be cancelled until unlock. */
    lock: () => { locked = true; if (cards.size) refresh(); },
    unlock: () => { locked = false; if (cards.size) refresh(); },
    /** Gone without a word (nothing to report). */
    clear: (id: string) => {
      if (cards.has(id)) emit({ id, state: "clear", p: null });
      doneSteps.delete(id);
      cards.get(id)?.el.remove();
      cards.delete(id);
      refresh();
    },
    has: (id: string) => cards.has(id),
    dispose: () => box.remove(),
  };
}

export type Tasks = ReturnType<typeof createTasks>;
