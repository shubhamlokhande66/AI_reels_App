/**
 * What Fast Studio is doing right now, always in view: one floating card per process (adding the song, checking the
 * beats, reading the clips, AI, captions, export, saving to My Reels) with a small live animation for its kind instead of
 * a spinner, the step in plain words, a progress bar and the time left. When it finishes the card turns into a tick and
 * slides away; a failure stays a little longer, in red. Styled with Tailwind (animations: app/globals.css @theme).
 * Each change is also told to the page as a "studio-task" event on the host ({ id, kind, state, p, title }), so the
 * Create flow's "Analysing" screen (flow.ts) shows the same progress.
 */

export type TaskEvent = { id: string; kind?: TaskKind; state: "start" | "progress" | "done" | "fail" | "clear"; p: number | null; title?: string };

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
const CROSS = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;

const left = (s: number) => (s < 1.5 ? "almost done" : s < 60 ? `about ${Math.ceil(s)} s left` : `about ${Math.ceil(s / 60)} min left`);

export function createTasks(host: HTMLElement) {
  const cards = new Map<string, Card>();
  const box = document.createElement("div");
  box.setAttribute("aria-live", "polite"); box.dataset.tasks = "1";
  box.className =
    "pointer-events-none fixed inset-x-0 bottom-[calc(96px+env(safe-area-inset-bottom))] z-[82] flex flex-col items-center gap-2 px-3 md:inset-x-auto md:bottom-6 md:right-6 md:items-end";
  host.appendChild(box);
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
        "pointer-events-auto flex w-[min(100%,380px)] items-center gap-3 rounded-2xl border border-border bg-surface/95 px-3.5 py-3 text-foreground shadow-[0_14px_40px_-12px_rgba(0,0,0,.45)] backdrop-blur-md transition-all duration-300 motion-safe:animate-pop";
      el.innerHTML = `<span data-ic class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent">${ICON[kind]}</span>
        <span class="min-w-0 flex-1">
          <span class="flex items-baseline justify-between gap-2"><b data-t class="truncate text-[14px] font-semibold"></b><span data-i class="shrink-0 text-[11.5px] tabular-nums text-muted"></span></span>
          <span data-d class="block truncate text-[12.5px] text-muted"></span>
          <span class="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-foreground/10"><i data-bar class="block h-full rounded-full bg-accent transition-[width] duration-300"></i></span>
        </span>`;
      box.appendChild(el);
      c = { el, kind, t0: performance.now(), p: null };
      cards.set(id, c);
    } else {
      c.t0 = performance.now();
      c.p = null;
      c.el.classList.remove("border-danger/60", "opacity-0", "translate-y-2");
      c.el.querySelector("[data-ic]")!.innerHTML = ICON[kind];
      c.el.querySelector("[data-ic]")!.className = "grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent";
    }
    paint(c, title, detail);
    emit({ id, kind, state: "start", p: null, title });
  }

  /** Progress (0..1, or null when unknown) and the step in words. */
  function update(id: string, p: number | null, detail?: string, title?: string) {
    const c = cards.get(id);
    if (!c) return;
    c.p = p;
    paint(c, title, detail);
    emit({ id, kind: c.kind, state: "progress", p, title });
  }

  function finish(id: string, ok: boolean, text: string, ms: number) {
    const c = cards.get(id);
    if (!c) return;
    const ic = c.el.querySelector<HTMLElement>("[data-ic]")!;
    ic.innerHTML = ok ? TICK : CROSS;
    ic.className = `grid h-11 w-11 shrink-0 place-items-center rounded-xl ${ok ? "bg-success/15 text-success" : "bg-danger/15 text-danger"}`;
    if (!ok) c.el.classList.add("border-danger/60");
    c.p = ok ? 1 : c.p;
    paint(c, undefined, text);
    emit({ id, kind: c.kind, state: ok ? "done" : "fail", p: c.p, title: text });
    if (ok) c.el.querySelector("[data-i]")!.textContent = "";
    c.timer = setTimeout(() => {
      c.el.classList.add("opacity-0", "translate-y-2");
      setTimeout(() => {
        c.el.remove();
        if (cards.get(id) === c) cards.delete(id);
      }, 320);
    }, ms);
  }

  return {
    start,
    update,
    /** Finished: a tick, then the card slides away. */
    done: (id: string, text = "Done") => finish(id, true, text, 1600),
    /** Did not work: shown in red a little longer. */
    fail: (id: string, text: string) => finish(id, false, text, 5000),
    /** Gone without a word (nothing to report). */
    clear: (id: string) => {
      if (cards.has(id)) emit({ id, state: "clear", p: null });
      cards.get(id)?.el.remove();
      cards.delete(id);
    },
    has: (id: string) => cards.has(id),
    dispose: () => box.remove(),
  };
}

export type Tasks = ReturnType<typeof createTasks>;
