/** Fast Studio's editor, one view for everyone (like CapCut or VN), on the markup of components/studio/markup.ts (the
 * editing itself is the engine's; everything here shows, hides or forwards to the engine's own controls):
 * - every tool in one bar (Shot, Music, Text, Captions, Look, Motion, Background, Overlay, Voice, Style), one panel open
 *   at a time; computers: the tools down the left, the preview in the middle, the open tool on the right and the
 *   multi-track timeline (video, text, voice, music) underneath; phones: the tools in a row under the preview.
 * - the plan's tools (PLAN_TOOLS: Motion, Layers, Background, Voice) need the plan the administrator set for them (Admin →
 *   Settings → Plan locks → Studio tools; Pro by default): on a lower plan they carry that plan's tag (PRO, CREATOR…)
 *   and a tap opens the pricing page instead. The administrator has everything, and "View as Free" in the top bar
 *   shows the studio as a free plan sees it.
 * Also: the song and clips steps fold into one line once the Reel is made, the top bar's title and Export. */

export type StudioView = "one" | "all"; // "all": every panel open (checks and support, by link only)
// the tool bar's tools a plan opens (lib/plan-locks.ts, group "studio"); a lower plan sees its tag and /pricing
export const PLAN_TOOLS = new Set(DEFAULT_LOCKS.groups.find((g) => g.id === "studio")!.items.map((it) => it.key));

type Shot = { in?: number; scaleR?: number; start: number; end: number; src: number; type: string; tr: string; efx: string; uk?: { t: number }[]; ak?: { t: number }[]; acc?: { at: number; do: string }[]; sp?: { label: string } };
type Ov = { t0: number; t1: number; all?: boolean; text: string; emoji?: boolean };
type Trim = { i: number; to: number; left?: boolean };
type Studio = {
  now: number; playing: boolean; dur: number; audio: AudioBuffer | null; beats: number[]; songName: string; title: string; hook: string; capsOn: boolean;
  edit: Shot[]; overlays: Ov[]; vo: unknown; kind: string; editGen: number;
  sources: { name: string; card?: HTMLElement; strip?: { t: number; c: HTMLCanvasElement }[] }[]; shotCs: ClipApi["shotCs"]; shotSet: ClipApi["shotSet"]; shotSlip: ClipApi["shotSlip"]; shotTrim: ClipApi["shotTrim"]; shotExtract: ClipApi["shotExtract"]; shotReverse: ClipApi["shotReverse"]; shotOp: (op: "split" | "dup" | "delete" | "replace" | "freeze", arg?: number) => boolean; snap: () => unknown; unsnap: (s: unknown) => boolean; shotRipple: (i: number, to: number) => boolean; shotMove: (from: number, to: number) => boolean; shotRoll: (i: number, to: number) => boolean;
  ovSelect: (i: number) => void; ovRefresh: () => void; ovSel: number;
  kfTarget: () => { what: string; a: number; b: number } | null;
  section: { start: number; len: number; whole: number; auto: boolean };
  segAt: (t: number) => number; kfSeek: (t: number) => Promise<void>;
};

export function savedView(): StudioView {
  try {
    return new URLSearchParams(location.search).get("view") === "all" ? "all" : "one";
  } catch {
    return "one";
  }
}
const fmt = (t: number) => { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return m + ":" + (s < 9.95 ? "0" : "") + s.toFixed(1); };
const fmtS = (t: number) => fmt(t).replace(/\.\d$/, "");
const fmt2 = (t: number) => { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return m + ":" + (s < 9.995 ? "0" : "") + s.toFixed(2); }; // 0:03.20
const CLIP_COL = ["#6b5540", "#46596a", "#5a4766", "#476452", "#6e4a44", "#5f5a3c", "#3f5d63", "#6a5a2e"]; // as the engine's strip
const TYPE: Record<string, string> = { drop: "Drop", hit: "Hit", cut: "Cut", break: "Break", talk: "Talk", jump: "Talk" };
import { CLIP_TOOLS, clipToolsEvents, clipToolsHtml, type ClipApi } from "./clipTools";
import { DEFAULT_LOCKS, needMap, PLAN_NAME, planRank, type PlanId } from "@shubix/core/lib/plan-locks";
import { tx } from "./i18n";
import { Glyph, GLYPH_PATHS } from "./markup";
import { TW } from "./tw";

const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function initViews(root: HTMLElement, onView: (v: StudioView) => void) {
  const ac = new AbortController(), sig = { signal: ac.signal };
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>("#" + id)!;
  const S = () => (root as unknown as { __studio?: Studio }).__studio;
  const kf = $<HTMLDetailsElement>("kfbox");
  const view: StudioView = savedView();
  let tool = "";
  let shotKey = "", lanesKey = "", shotTab = 0, ctOpen = "", ctKey = "", revealKey = "", shownTool = "";
  const q = new URLSearchParams(location.search).get("tool");
  // The made Reel opens as a review: the preview big, Change Reel, Export and Edit. Edit opens the timeline and the tools
  // (✓ Done editing goes back). A saved Reel opened again (?p=) or a tool asked for (?tool=) opens in the editor.
  // The new design shows the preview, Clip Controls, the timeline and the tools together, on phones too: the made Reel
  // always opens in the editor (the older "review" screen hid the timeline behind an Edit button the design no longer has,
  // so a phone coming from Generate had no timeline at all)
  let editing = true;
  const reviewNow = () => made() && !root.classList.contains("fopen") && !editing;
  const setEditing = (on: boolean) => { editing = on; if (!on && !wide()) tool = ""; apply(); if (on) requestAnimationFrame(() => $("lanes").scrollIntoView({ block: "nearest" })); };

  const made = () => !$("s3").classList.contains("locked");
  // computers keep a tool open beside the preview (the shot first); phones show the Reel, a tool opens over it
  const wide = () => window.matchMedia("(min-width: 1024px)").matches;
  const defTool = () => ""; // the Reel first, as on the phone: a tool's panel opens from the dock (computers: beside the preview)
  // the plan's tools: the plan seen last (the engine keeps it on the phone), then what the engine reads from the server
  // ("brs-plan" below). Billing off or the administrator: all open; the administrator's View as Free: the free plan.
  let plan = "free", open = false, need: Record<string, string> = needMap(DEFAULT_LOCKS);
  try { const c = JSON.parse(localStorage.getItem("brs-plan") || "null"); if (c && Date.now() - c.at < 7 * 864e5) { plan = c.plan || "free"; open = !!c.open; if (c.need) need = c.need; } } catch {}
  try { if (localStorage.getItem("brs-asfree") === "1") root.classList.add("asfree"); } catch {}
  const asFree = () => root.classList.contains("admin") && root.classList.contains("asfree");
  const needOf = (k: string) => (need["studio:" + k] || "free") as PlanId;
  const locked = (k: string) => PLAN_TOOLS.has(k) && (asFree() ? planRank(needOf(k)) > 0 : !open && !root.classList.contains("planadmin") && planRank(needOf(k)) > planRank(plan));
  // each plan's tool: locked or not, and its tag says the plan it needs
  const paintLocks = () => root.querySelectorAll<HTMLButtonElement>(".tool").forEach((b) => {
    const k = b.dataset.tool!, lock = String(locked(k)), tag = b.querySelector(".protag b");
    if (b.dataset.locked !== lock) b.dataset.locked = lock;
    const name = PLAN_NAME[needOf(k)] ?? "Pro", title = lock === "true" ? name + " plan: tap to see the plans" : "";
    if (tag && tag.textContent !== name.toUpperCase()) tag.textContent = name.toUpperCase();
    if (b.title !== title) b.title = title;
  });
  const apply = () => {
    root.classList.remove("v-simple", "v-editor", "v-pro", "v-one", "v-all");
    root.classList.add("v-" + view);
    if (tool && !wide() && !editing) editing = true; // a phone: a tool opened means editing
    root.dataset.tool = tool;
    root.classList.toggle("made", made());
    root.classList.toggle("editing", editing);
    root.classList.toggle("review", reviewNow());
    // the left panel's tabs: lit for the tool they open
    const PT: Record<string, string> = { media: "media", music: "music", text: "text", look: "filters" };
    root.querySelectorAll<HTMLButtonElement>("#ptabs [data-pt]").forEach((b) => b.setAttribute("aria-pressed", String(PT[tool] === b.dataset.pt)));
    root.querySelectorAll<HTMLButtonElement>(".tool").forEach((b) => {
      const active = b.dataset.tool === tool;
      b.setAttribute("aria-pressed", String(active));
      b.classList.toggle("categoryActive", active);
    });
    paintLocks();
    const on = new Set(view === "all" ? [...root.querySelectorAll<HTMLElement>(".panel")].map((p) => p.dataset.panel!) : tool ? [tool] : []);
    root.querySelectorAll<HTMLElement>(".panel").forEach((p) => p.classList.toggle("on", on.has(p.dataset.panel!)));
    // the keyframe panel is open when Motion is shown (dragging the picture then moves the shot)
    const kfWant = on.has("motion");
    if (on.has("look")) { const st = S(), th = st && st.edit.length ? thumbOf(st.edit[Math.max(0, st.segAt(st.now))].src) : ""; $("look").style.setProperty("--lookth", th ? `url(${th})` : ""); }
    if (kfWant) { kfMoves(); const st = S(), T = st && st.kfTarget(); if (st && T && T.what === "text" && (st.now < T.a || st.now >= T.b)) void st.kfSeek(T.a + 0.05); }
    if (kf.open !== kfWant) kf.open = kfWant;
    if (view === "all") $<HTMLDetailsElement>("allshots").open = true;
    shotKey = ""; lanesKey = "";
    if (tool !== shownTool) { shownTool = tool; requestAnimationFrame(() => reveal(root.querySelector(".panel.on"))); }
    requestAnimationFrame(() => { const st = S() as (Studio & { drawTimeline?: () => void }) | undefined; if (st && st.edit.length) st.drawTimeline?.(); });   // the strip at its new size
  };
  // a picker opened (a tool, the shot's Transition / Effect): its chosen item is scrolled into view, so nobody has to
  // hunt for it in a long list. The longest list in the box counts; only its own scrolling boxes move, never the page.
  const reveal = (box: Element | null) => {
    if (!box) return;
    const on = [...box.querySelectorAll<HTMLElement>(':is(.seg,.chips,.sstiles,.tpl) > [aria-pressed="true"]')]
      .sort((a, b) => b.parentElement!.childElementCount - a.parentElement!.childElementCount)[0];
    if (!on || on.parentElement!.childElementCount < 6) return;
    for (let p = on.parentElement; p && p !== root; p = p.parentElement) {
      const s = getComputedStyle(p), y = /(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight + 1, x = /(auto|scroll)/.test(s.overflowX) && p.scrollWidth > p.clientWidth + 1;
      if (!x && !y) continue;
      const r = on.getBoundingClientRect(), pr = p.getBoundingClientRect();
      if (x) p.scrollLeft += r.left - pr.left - (pr.width - r.width) / 2;
      if (y) { p.scrollTop += r.top - pr.top - (pr.height - r.height) / 2; return; } // a sideways strip: its column too
    }
  };
  const openStep = (id: string, open: boolean) => {
    const s = $(id), h = s.querySelector<HTMLButtonElement>(".sh")!;
    s.classList.toggle("folded", !open);
    h.setAttribute("aria-expanded", String(open));
  };
  const copyReel = () => root.querySelector<HTMLButtonElement>('#mode [data-m="copy"]')?.click();

  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const px = t.closest<HTMLElement>("[data-proxy]"); if (px) { $(px.dataset.proxy!).click(); return; }
    const os = t.closest<HTMLElement>("[data-open-step]"); if (os) { const id = os.dataset.openStep!; openStep(id, true); $(id).scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    if (t.closest("#copycard")) { copyReel(); return; }
    const pt = t.closest<HTMLButtonElement>("#ptabs [data-pt]");
    if (pt) {
      const k = pt.dataset.pt!, st = S();
      if (k === "effects" || k === "transitions") { // the shot at the playhead, in the shot sheet
        if (st && st.edit.length) { const i = Math.max(0, st.segAt(st.now)); openShot(i, k === "effects" ? 1 : 0, xOf((st.edit[i].start + st.edit[i].end) / 2)); }
        return;
      }
      if (sheet.classList.contains("docked")) closeShot();
      tool = k === "stickers" ? "text" : k === "filters" ? "look" : k; apply();
      if (k === "stickers") $("ovsticker").scrollIntoView({ block: "nearest" });
      return;
    }
    if (t.closest("#fedit")) { setEditing(true); return; }
    if (t.closest("#tbasfree")) { // the administrator: see the studio as a free plan sees it (the engine repaints its crowns)
      const on = !root.classList.contains("asfree");
      root.classList.toggle("asfree", on);
      try { localStorage.setItem("brs-asfree", on ? "1" : "0"); } catch {}
      if (tool && locked(tool)) tool = defTool();
      apply(); root.dispatchEvent(new Event("brs-asfree"));
      return;
    }
    if (t.closest("#feditdone")) { closeShot(); selectClip(-1); setEditing(false); return; }
    const b = t.closest<HTMLButtonElement>(".tool");
    if (b) {
      const k = b.dataset.tool!;
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- plain DOM code, the pricing page is a full load
      if (locked(k)) { location.assign("/pricing?feature=" + encodeURIComponent(k)); return; } // a Pro tool on a free plan
      if (k === "stickers") { tool = "text"; apply(); $("ovsticker")?.click(); return; }
      if (k === "filters") { tool = "look"; apply(); return; }
      // Shots, as on the phone: the clip under the playhead, selected (its tools are in the bar), not a panel of the same tools
      if (k === "shots") { const st = S(); if (st && st.edit.length) { if (!editing) setEditing(true); selectClip(Math.max(0, st.segAt(st.now))); } return; }
      tool = tool === k ? "" : k; // a second tap closes it again
      if (sel >= 0) selectClip(-1, false);
      apply();
      return;
    }
    const sh = t.closest<HTMLButtonElement>(".step > .sh");
    if (sh) { const s = sh.parentElement!; openStep(s.id, s.classList.contains("folded")); }
  }, sig);

  // the "shots repeat" note: a tap opens Media to add clips
  $("xmsg").addEventListener("click", () => { if ($("xmsg").classList.contains("addclips")) { tool = "media"; apply(); } }, sig);
  // computers: the tool panel's ✕ closes it (the Reel takes the whole width again)
  $("pclose").addEventListener("click", () => { tool = ""; apply(); }, sig);
  $("pdone")?.addEventListener("click", () => { tool = ""; apply(); }, sig); // the popup's Done: every change is already in the Reel
  // play over the preview, previous / next shot
  $("playov").addEventListener("click", () => $("play").click(), sig);
  // the progress bar under the preview: tap or drag along it to move through the Reel
  const bar = root.querySelector<HTMLElement>(".stage .bar")!;
  let barDrag = false;
  const barSeek = (x: number) => { const st = S(); if (!st || !st.dur || !made()) return; const r = bar.getBoundingClientRect(); void st.kfSeek(Math.max(0, Math.min(st.dur - 0.01, ((x - r.left) / r.width) * st.dur))); };
  bar.addEventListener("pointerdown", (e) => { barDrag = true; try { bar.setPointerCapture(e.pointerId); } catch { /* gone */ } barSeek(e.clientX); }, sig);
  bar.addEventListener("pointermove", (e) => { if (barDrag) barSeek(e.clientX); }, sig);
  for (const ev of ["pointerup", "pointercancel"]) bar.addEventListener(ev, () => { barDrag = false; }, sig);
  const jump = (d: number) => { const st = S(); if (!st || !st.edit.length) return; const i = Math.max(0, Math.min(st.edit.length - 1, st.segAt(st.now) + d)); void st.kfSeek(st.edit[i].start + 0.05); };
  $("pshot").addEventListener("click", () => jump(-1), sig);
  $("nshot").addEventListener("click", () => jump(1), sig);
  $("soundstate")?.addEventListener("click", () => {
    muteMusic();
    const ss = $("soundstate");
    if (ss) {
      const isM = muted0();
      ss.innerHTML = `${Glyph("Music", 14)} SOUND ${isM ? "MUTED" : "ON"}`;
      ss.style.opacity = isM ? "0.6" : "1";
    }
  }, sig);

  // the top bar's Export is the same button as the save bar's
  const exp = $<HTMLButtonElement>("export"), top = $<HTMLButtonElement>("topexport");
  top.addEventListener("click", () => exp.click(), sig);
  // the Media panel (a computer's left panel): the clips step's own Videos / Photos, drop zone and clips, moved in while
  // the editor is open and back to the Create flow's clips step when it opens again
  const mediaParts = [$("ftabs"), $("dropzone"), root.querySelector<HTMLElement>(".fclipgrid")!];
  const mediaHome = mediaParts.map((el) => ({ el, parent: el.parentElement!, next: el.nextSibling }));
  const media = (into: boolean) => {
    if (into) mediaParts.forEach((el) => $("mslot").append(el));
    else for (const h of [...mediaHome].reverse()) if (h.el.parentElement !== h.parent) h.parent.insertBefore(h.el, h.next && h.next.parentNode === h.parent ? h.next : null);
  };
  // Motion's ready-made moves as picture tiles (the design's frame 7): the shot's own picture, the move's name; a tap
  // applies it (the engine's own list, #kfpreset)
  const kfMoves = () => {
    const box = $("kfmoves"), sel = $<HTMLSelectElement>("kfpreset"), st = S();
    if (!box.childElementCount) for (const o of [...sel.options].filter((x) => x.value)) {
      const b = document.createElement("button"); b.type = "button"; b.className = "kfmove grid gap-[5px] p-0 border-0 bg-none text-muted [font:600_11px_var(--body)] cursor-pointer text-center hover:text-foreground"; b.dataset.v = o.value;
      b.innerHTML = `<span class="kfmimg block aspect-[4/3] rounded-[10px] [background:var(--surface-2)_center/cover_no-repeat] shadow-[inset_0_0_0_1px_var(--border)] in-[.kfmove:hover]:shadow-[0_0_0_2px_var(--accent)]"></span><span class="kfmt">${esc(o.text)}</span>`;
      b.addEventListener("click", () => { sel.value = o.value; sel.dispatchEvent(new Event("change")); }, sig);
      box.append(b);
    }
    const th = st && st.edit.length ? thumbOf(st.edit[Math.max(0, st.segAt(st.now))].src) : "";
    box.querySelectorAll<HTMLElement>(".kfmimg").forEach((el) => { const v = th ? `url(${th})` : ""; if (el.style.backgroundImage !== v) el.style.backgroundImage = v; });
  };
  // the top bar's format (9:16 ▾): the clips step's own Format buttons
  // (a menu of its own, not a <select>: the bar is redrawn while it plays, which closed a native list before a choice was made)
  // the Format menu: under the top bar's button, or (the preview card's 9:16 button) under that one, over the page
  const aspMenu = (on: boolean, at?: HTMLElement) => {
    const m = $("tbaspmenu"); m.hidden = !on; $("tbaspbtn").setAttribute("aria-expanded", String(on)); $("prevaspbtn")?.setAttribute("aria-expanded", String(on && !!at));
    m.classList.toggle("atprev", on && !!at);
    if (on && at) { const r = at.getBoundingClientRect(); m.style.top = Math.round(r.bottom + 6) + "px"; m.style.left = Math.round(Math.max(8, Math.min(r.right - 220, innerWidth - 228))) + "px"; }
    else { m.style.top = ""; m.style.left = ""; }
  };
  $("tbaspbtn").addEventListener("click", (e) => { e.stopPropagation(); aspMenu($("tbaspmenu").hidden); }, sig);
  $("prevaspbtn")?.addEventListener("click", (e) => { e.stopPropagation(); aspMenu($("tbaspmenu").hidden, e.currentTarget as HTMLElement); }, sig);
  addEventListener("scroll", () => { if ($("tbaspmenu").classList.contains("atprev")) aspMenu(false); }, { passive: true, signal: sig.signal }); // it stays by its button
  $("tbaspmenu").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-a]"); if (!b) return;
    root.querySelector<HTMLButtonElement>(`#aspect [data-a="${b.dataset.a}"]`)?.click(); aspMenu(false); $("tbaspbtn").focus();
  }, sig);
  document.addEventListener("click", (e) => { if (!$("tbaspmenu").hidden && !$("tbasp").contains(e.target as Node)) aspMenu(false); }, sig);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("tbaspmenu").hidden) { aspMenu(false); $("tbaspbtn").focus(); } }, sig);
  // the top bar's Back: the Create flow's own (the screen before: the clips, or where the page came from)
  $("tbback").addEventListener("click", () => { $("fback").click(); }, sig);
  $("tbchat").addEventListener("click", () => $("chatfab").click(), sig);
  const mirror = () => { if (top.disabled !== exp.disabled) top.disabled = exp.disabled; // only on a change: a write is a mutation too
    for (const [a, b] of [["tundo", "undo"], ["tredo", "redo"]] as const) { const x = $<HTMLButtonElement>(a), y = $<HTMLButtonElement>(b); if (x.disabled !== y.disabled) x.disabled = y.disabled; } };

  // the title and the summary show what is made now
  const setText = (el: Element | null, v: string) => { v = tx(v); if (el && el.textContent !== v) el.textContent = v; }; // the admin's wording (i18n.ts)
  const values = () => {
    const st = S();
    const asp = root.querySelector<HTMLElement>('#aspect [aria-pressed="true"]')?.dataset.a;
    if (asp) {
      if ($("tbaspv") && $("tbaspv").textContent !== asp) $("tbaspv").textContent = asp;
      const prevAsp = $("prevaspv");
      if (prevAsp && prevAsp.textContent !== asp) prevAsp.textContent = asp;
      $("tbaspmenu")?.querySelectorAll<HTMLElement>("[data-a]").forEach((b) => {
        const on = String(b.dataset.a === asp);
        if (b.getAttribute("aria-selected") !== on) b.setAttribute("aria-selected", on);
      });
      const vframe = root.querySelector<HTMLElement>(".videoFrame");
      if (vframe && asp) {
        // the format's shape; studio.css sizes the frame to fill the preview card's room with it (--ar: width / height)
        const [aw, ah] = (asp.match(/^(\d+):(\d+)$/) ? asp : "9:16").split(":").map(Number);
        if (vframe.dataset.asp !== asp) { vframe.dataset.asp = asp; vframe.style.aspectRatio = aw + " / " + ah; vframe.style.setProperty("--ar", String(aw / ah)); }
      }
    }
    if (st && made()) {
      setText($("tbname"), st.title || "Your Reel");
      const talk = st.kind === "talk";
      const info = fmtS(st.dur) + " · " + st.edit.length + (talk ? " parts, pauses cut" : " shots") + (st.songName && !talk ? " on the beat of " : "");
      const si = $("suminfo");
      if (si && si.dataset.k !== info + st.songName) { si.dataset.k = info + st.songName; si.textContent = info; if (st.songName && !talk) { const b = document.createElement("b"); b.textContent = st.songName; si.append(b); } }
      const sec = st.section, part = sec && sec.whole && sec.len < sec.whole - 0.5 ? " · " + fmtS(sec.start) + "–" + fmtS(sec.start + sec.len) : "";
      setText($("tlmusic"), st.songName ? "♪ " + st.songName + part + " · beats marked" : talk ? "The voice of your clips" : "");
    } else setText($("tbname"), "Your Reel");
  };

  // the current shot: chips (the Shot tool) and the inspector, both forwarding to the edit list's own controls
  const rowOf = (i: number) => root.querySelectorAll<HTMLTableRowElement>("#edl tr")[i];
  const shotUI = () => {
    const st = S(); if (!st || !made() || !st.edit.length) return;
    const i = st.segAt(st.now), e = st.edit[i], row = rowOf(i); if (!e || !row) return;
    const durStr = (e.end - e.start).toFixed(1) + " s";
    setText($("inspect-shot-title"), "Shot " + String(i + 1).padStart(2, "0"));
    setText($("inspect-shot-dur"), durStr);
    setText($("framecounter"), String(i + 1).padStart(2, "0") + " / " + String(st.edit.length).padStart(2, "0"));
    setText($("tlsub"), st.edit.length + " clips · " + (5 + (st.overlays ? st.overlays.length : 0)) + " layers");
    setText($("tltime"), fmt2(st.now) + " / " + fmt2(st.dur));
    setText($("psaved-status"), "All changes saved");
    const sels = [3, 4, 5].map((c) => row.children[c]?.querySelector("select") as HTMLSelectElement | null);
    const key = view + "|" + shotTab + "|" + i + "|" + st.editGen + "|" + sels.map((s) => s && s.value).join() + "|" + (e.uk ? e.uk.length : 0) + "|" + root.querySelectorAll("#edl tr").length;
    if (key === shotKey) return; shotKey = key; markTabs();
    const names = ["Transition", "Effect", "Speed"];
    // as in the design: "Shot 1 · Transition" with its choices as chips (Effect and Speed one tap away)
    const head = `<div class="shh flex justify-between items-baseline gap-2 flex-wrap [&_b]:text-[14px] [&_span]:text-[12px] [&_span]:text-muted in-[.ss-body]:sticky in-[.ss-body]:top-0 in-[.ss-body]:z-[1] in-[.ss-body]:my-0 in-[.ss-body]:-mx-4 in-[.ss-body]:pt-1 in-[.ss-body]:px-4 in-[.ss-body]:pb-2.5 in-[.ss-body]:bg-surface in-[.ss-body]:[border-bottom:1px_solid_var(--border)]"><span class="shtabs flex gap-1 items-center"><b>Shot ${i + 1} ·</b>${names.map((n, k) => `<button type="button" class="shtab border-0 bg-transparent text-muted [font:600_13.5px_var(--body)] py-1.5 px-2 rounded-[8px] cursor-pointer aria-pressed:text-foreground aria-pressed:bg-[color:var(--chipbg)] in-[.ss-body]:text-[14px] in-[.ss-body]:aria-pressed:[background:var(--gold-gradient)] in-[.ss-body]:aria-pressed:text-[color:var(--on-accent,#fff)]" data-tab="${k}" aria-pressed="${k === shotTab}">${n}</button>`).join("")}</span><span>${(e.end - e.start).toFixed(2)} s · ${esc(TYPE[e.type] || e.type)}</span></div>`;
    const s0 = sels[shotTab];
    const chips = !s0 ? "" : shotTab < 2 ? `<div class="shtilebox mt-1 mx-0 mb-2.5">${tilesHtml(shotTab, sels, thumbOf(e.src))}</div>` : `<div class="chips ${TW.chips}">${[...s0.options].map((o) => `<button type="button" class="chip ${TW.chip}" data-c="${shotTab}" data-v="${esc(o.value)}" aria-pressed="${o.value === s0.value}">${esc(o.text)}</button>`).join("")}</div>`;
    const selects = sels.map((s, k) => !s ? "" : `<label class="isel grid gap-1 text-[12.5px] text-muted [&_select]:h-9.5 [&_select]:rounded-[10px] [&_select]:border [&_select]:border-border [&_select]:bg-surface [&_select]:text-foreground [&_select]:[font:13.5px_var(--body)] [&_select]:py-0 [&_select]:px-2 [&_select]:w-full"><span>${names[k]}</span><select data-c="${k}">${[...s.options].map((o) => `<option value="${esc(o.value)}"${o.value === s.value ? " selected" : ""}>${esc(o.text)}</option>`).join("")}</select></label>`).join("");
    const other = `<button type="button" class="btn ${TW.btn} ghost" data-other="1"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/></svg><span>Use a different moment</span></button>`;
    // split, duplicate, delete, replace (the music's timing stays; see the engine's shotOp)
    const tools = st.kind === "talk" ? "" : `<div class="shtools flex flex-wrap gap-1.5 items-center [&_select]:h-9 [&_select]:max-w-47.5" role="group" aria-label="Shot tools">`
      + `<button type="button" class="btn ${TW.btn} ghost" data-op="split" title="Split this shot where the playhead is">Split</button>`
      + `<button type="button" class="btn ${TW.btn} ghost" data-op="dup" title="Play this moment twice">Duplicate</button>`
      + `<button type="button" class="btn ${TW.btn} ghost" data-op="freeze" title="Freeze the picture at the playhead, then play on">Freeze</button>`
      + `<button type="button" class="btn ${TW.btn} ghost" data-op="delete" title="Delete this shot; the shot before takes its time"${st.edit.length < 2 ? " disabled" : ""}>Delete</button>`
      + `</div><div class="cliptools ${TW.cliptools}"></div>`;
    $("shotcard").innerHTML = head + chips + other + tools;
    $("inspector").innerHTML = `<div class="ihead text-[11.5px] tracking-[.08em] uppercase text-muted">Shot ${i + 1} · Inspector</div>` + selects + other + tools;
    if (!$("shotsheet").hidden) $("ssbody").innerHTML = sheetHtml(i, sels); // the shot sheet (the design's frame 3)
    clipUI(true);
    const rk = i + "|" + shotTab + "|" + $("shotsheet").hidden; // another shot or tab: its chosen tile in view
    if (rk !== revealKey) { revealKey = rk; requestAnimationFrame(() => { reveal($("ssbody")); reveal($("shotcard")); }); }
  };
  // the shot sheet, as the design: the shot's picture, "Shot 1 · 2.40 s", ‹ ›; Transition (29) · Effect (25) · Speed as
  // picture tiles (the shot's own lit); Speed; the actions with their signs; the clip tools, sideways
  const thumbs = new Map<HTMLCanvasElement, string>();
  const thumbOf = (src: number) => {
    const c = S()?.sources[src]?.card?.querySelector<HTMLCanvasElement>(".th"); if (!c || !c.width) return "";
    let u = thumbs.get(c); if (!u) { try { u = c.toDataURL("image/jpeg", 0.72); } catch { u = ""; } if (u) thumbs.set(c, u); }
    return u || "";
  };
  const SIGN: Record<string, string> = {
    split: '<path d="M6 3v18M18 3v18M6 12h12"/>', dup: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>',
    freeze: '<path d="M12 2v20M4.5 6.5l15 11M19.5 6.5l-15 11"/>', delete: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    other: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>',
  };
  const sign = (k: string) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SIGN[k]}</svg>`;
  // the speed slider's scale: 0.2× at 0, 4× at 100, the same step for each doubling (1× near the middle)
  const SPD_LO = 0.2, SPD_HI = 4;
  const spdPos = (v: number) => (Math.log(Math.min(SPD_HI, Math.max(SPD_LO, v)) / SPD_LO) / Math.log(SPD_HI / SPD_LO)) * 100;
  const spdOf = (p: number) => { const v = SPD_LO * Math.pow(SPD_HI / SPD_LO, p / 100); return Math.abs(v - 1) < 0.04 ? 1 : Math.round(v * 20) / 20; };
  const spdTxt = (v: number) => (v < 1 ? v.toFixed(2).replace(/0$/, "") : v.toFixed(1).replace(/\.0$/, "")) + "×";
  // Transition / Effect choices as square picture tiles (the shot sheet and the Shots tool), on the shot's own picture
  const tilesHtml = (k: number, sels: (HTMLSelectElement | null)[], th: string | null | undefined) => { const sl = sels[k]; if (!sl) return "";
      return `<div class="sstiles in-[:is(.ss-body,.shtilebox)]:grid in-[:is(.ss-body,.shtilebox)]:grid-cols-[repeat(auto-fill,minmax(64px,1fr))] in-[:is(.ss-body,.shtilebox)]:gap-2 max-lg:in-[:is(.ss-body,.shtilebox)]:grid-cols-[repeat(auto-fill,minmax(60px,1fr))] in-[:is(.ss-body,.shtilebox)]:items-start in-[.shtilebox]:grid-cols-[repeat(auto-fill,minmax(64px,1fr))] in-[#shotsheet]:min-h-0 in-[#shotsheet]:pt-0.5 in-[#shotsheet]:px-0.5 in-[#shotsheet]:pb-2 in-[#shotsheet]:grid! in-[#shotsheet]:grid-cols-[repeat(auto-fill,minmax(112px,1fr))]! in-[#shotsheet]:gap-2.5! max-[680px]:in-[#shotsheet]:grid-cols-3! max-[680px]:in-[#shotsheet]:gap-2! max-[381px]:in-[#shotsheet]:grid-cols-2!">${[...sl.options].map((o) => `<button type="button" class="chip ${TW.chip} sstile in-[:is(.ss-body,.shtilebox)]:grid in-[:is(.ss-body,.shtilebox)]:gap-[5px] in-[:is(.ss-body,.shtilebox)]:h-auto in-[:is(.ss-body,.shtilebox)]:p-0 in-[:is(.ss-body,.shtilebox)]:border-0 in-[:is(.ss-body,.shtilebox)]:rounded-none in-[:is(.ss-body,.shtilebox)]:bg-none in-[:is(.ss-body,.shtilebox)]:text-muted in-[:is(.ss-body,.shtilebox)]:[font:600_10.5px_var(--body)] in-[:is(.ss-body,.shtilebox)]:text-center in-[:is(.ss-body,.shtilebox)]:whitespace-normal in-[:is(.ss-body,.shtilebox)]:aria-pressed:bg-none in-[:is(.ss-body,.shtilebox)]:aria-pressed:text-foreground in-[:is(.ss-body,.shtilebox)]:content-start in-[:is(.ss-body,.shtilebox)]:grid-rows-[auto_auto] in-[#shotsheet]:relative in-[#shotsheet]:min-w-0 in-[#shotsheet]:min-h-25 in-[#shotsheet]:h-auto! in-[#shotsheet]:flex! in-[#shotsheet]:flex-col in-[#shotsheet]:items-stretch! in-[#shotsheet]:justify-between in-[#shotsheet]:gap-2.5 in-[#shotsheet]:p-2.5! in-[#shotsheet]:text-muted! in-[#shotsheet]:border! in-[#shotsheet]:border-[color:var(--ed-line)]! in-[#shotsheet]:rounded-[14px]! in-[#shotsheet]:bg-[color:color-mix(in_srgb,var(--surface-2)_70%,var(--surface))]! in-[#shotsheet]:text-left in-[#shotsheet]:shadow-none! in-[#shotsheet]:cursor-pointer in-[#shotsheet]:[transition:transform_.18s_ease,border-color_.18s_ease,background_.18s_ease,box-shadow_.18s_ease] in-[#shotsheet]:hover:text-foreground! in-[#shotsheet]:hover:border-[color:color-mix(in_srgb,var(--accent)_42%,var(--border))]! in-[#shotsheet]:hover:[transform:translateY(-2px)] in-[#shotsheet]:aria-pressed:text-foreground! in-[#shotsheet]:aria-pressed:border-[color:color-mix(in_srgb,var(--accent)_65%,var(--border))]! in-[#shotsheet]:aria-pressed:bg-[color:color-mix(in_srgb,var(--accent)_11%,var(--surface))]! in-[#shotsheet]:aria-pressed:shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent)_22%,transparent)_inset,0_10px_22px_-18px_var(--brand-glow)]! in-[#shotsheet]:aria-pressed:after:[content:'✓'] in-[#shotsheet]:aria-pressed:after:absolute in-[#shotsheet]:aria-pressed:after:right-[9px] in-[#shotsheet]:aria-pressed:after:bottom-2 in-[#shotsheet]:aria-pressed:after:text-accent-hover in-[#shotsheet]:aria-pressed:after:text-[12px] in-[#shotsheet]:aria-pressed:after:font-extrabold max-[680px]:in-[#shotsheet]:min-h-21.5 max-[680px]:in-[#shotsheet]:p-2! max-[680px]:in-[#shotsheet]:rounded-[12px]!" data-c="${k}" data-v="${esc(o.value)}" aria-pressed="${o.value === sl.value}"><span class="sstimg in-[:is(.ss-body,.shtilebox)]:block in-[:is(.ss-body,.shtilebox)]:aspect-square in-[:is(.ss-body,.shtilebox)]:rounded-[10px] in-[:is(.ss-body,.shtilebox)]:[background:var(--surface-2)_center/cover_no-repeat] in-[:is(.ss-body,.shtilebox)]:shadow-[inset_0_0_0_1px_var(--border)] in-[:is(.ss-body,.shtilebox)_.sstile[aria-pressed=true]]:shadow-[0_0_0_2px_var(--accent),0_6px_16px_-8px_var(--brand-glow,rgba(168,139,78,.5))] in-[:is(.ss-body,.shtilebox)]:[&.none]:bg-surface-2! in-[:is(.ss-body,.shtilebox)]:[&.none]:relative in-[:is(.ss-body,.shtilebox)]:[&.none]:after:[content:'×'] in-[:is(.ss-body,.shtilebox)]:[&.none]:after:absolute in-[:is(.ss-body,.shtilebox)]:[&.none]:after:inset-0 in-[:is(.ss-body,.shtilebox)]:[&.none]:after:grid in-[:is(.ss-body,.shtilebox)]:[&.none]:after:place-items-center in-[:is(.ss-body,.shtilebox)]:[&.none]:after:[font:400_22px_var(--body)] in-[:is(.ss-body,.shtilebox)]:[&.none]:after:text-muted in-[:is(.ss-body,.shtilebox)]:w-full in-[:is(.ss-body,.shtilebox)]:h-auto in-[:is(.ss-body,.shtilebox)]:self-start in-[#shotsheet]:w-full! in-[#shotsheet]:h-14! in-[#shotsheet]:aspect-[auto]! in-[#shotsheet]:border! in-[#shotsheet]:border-[color:color-mix(in_srgb,var(--accent)_12%,var(--border))]! in-[#shotsheet]:rounded-[9px]! in-[#shotsheet]:bg-[color:color-mix(in_srgb,var(--background)_65%,var(--surface))]! in-[#shotsheet]:bg-cover in-[#shotsheet]:bg-center max-[680px]:in-[#shotsheet]:h-[43px]!${o.value === "hard" || o.value === "none" ? " none" : ""}"${th ? ` style="background-image:url(${th})"` : ""}></span><span class="sstt in-[:is(.ss-body,.shtilebox)]:leading-[1.2] in-[:is(.ss-body,.shtilebox)]:overflow-hidden in-[:is(.ss-body,.shtilebox)]:[display:-webkit-box] in-[:is(.ss-body,.shtilebox)]:[-webkit-line-clamp:2] in-[:is(.ss-body,.shtilebox)]:[-webkit-box-orient:vertical] in-[#shotsheet]:overflow-hidden in-[#shotsheet]:pr-3.5 in-[#shotsheet]:text-[10px]! in-[#shotsheet]:font-[650] in-[#shotsheet]:leading-[1.25] in-[#shotsheet]:text-left! in-[#shotsheet]:whitespace-normal! in-[#shotsheet]:[display:-webkit-box]! in-[#shotsheet]:[-webkit-box-orient:vertical] in-[#shotsheet]:[-webkit-line-clamp:2] max-[680px]:in-[#shotsheet]:text-[9px]!">${esc(o.text)}</span></button>`).join("")}</div>`; };
  const sheetHtml = (i: number, sels: (HTMLSelectElement | null)[]) => {
    const st = S()!, e = st.edit[i], th = thumbOf(e.src), names = ["Transition", "Effect", "Speed"];
    const tiles = (k: number) => tilesHtml(k, sels, th);
    // Speed: the ready ones as chips, and any speed on a slider (as the pro editors: 0.2× … 4×, 1× near the middle)
    const cv = st.shotCs()?.curve, flat = cv && ["a", "b", "c", "d", "e"].every((k) => cv[k as "a"] === cv.a) ? cv.a : null;
    const num = flat ?? (+((e.sp?.label || "").match(/([\d.]+)×/)?.[1] || "") || 1);
    const speed = !sels[2] ? "" : `<div class="sslab ${TW.sslab}">Speed</div><div class="chips ${TW.chips} sschips">${[...sels[2]!.options].map((o) => `<button type="button" class="chip ${TW.chip}" data-c="2" data-v="${esc(o.value)}" aria-pressed="${o.value === sels[2]!.value}">${esc(o.text)}</button>`).join("")}</div>`
      + `<div class="ssspd in-[.ss-body]:grid in-[.ss-body]:gap-1.5 in-[.ss-body]:p-3 in-[.ss-body]:rounded-[12px] in-[.ss-body]:bg-surface-2 in-[.ss-body]:border in-[.ss-body]:border-border"><div class="ssspdh in-[.ss-body]:flex in-[.ss-body]:justify-between in-[.ss-body]:items-baseline in-[.ss-body]:[font:600_12.5px_var(--body)] in-[.ss-body]:text-foreground in-[.ss-body]:[&_output]:[font:600_16px_var(--mono)] in-[.ss-body]:[&_output]:text-accent"><span>Custom speed</span><output id="ssspdv">${spdTxt(num)}</output></div><input type="range" id="ssspd" min="0" max="100" step="0.5" value="${spdPos(num).toFixed(1)}" aria-label="Speed">`
      + `<div class="ssspdt in-[.ss-body]:relative in-[.ss-body]:h-3.5 in-[.ss-body]:my-0 in-[.ss-body]:mx-2 in-[.ss-body]:[&_span]:absolute in-[.ss-body]:[&_span]:[transform:translateX(-50%)] in-[.ss-body]:[&_span]:[font:600_10px_var(--mono)] in-[.ss-body]:[&_span]:text-muted in-[.ss-body]:[&_span]:before:absolute in-[.ss-body]:[&_span]:before:left-[50%] in-[.ss-body]:[&_span]:before:-top-[5px] in-[.ss-body]:[&_span]:before:w-[1px] in-[.ss-body]:[&_span]:before:h-1 in-[.ss-body]:[&_span]:before:bg-muted" aria-hidden="true">${[0.2, 0.5, 1, 2, 4].map((v) => `<span style="left:${spdPos(v).toFixed(1)}%">${v}×</span>`).join("")}</div></div>`;
    const act = (op: string, n: string, extra = "") => `<button type="button" class="ssact ${TW.ssact}" data-op="${op}"${extra}>${sign(op)}<span>${n}</span></button>`;
    const actions = st.kind === "talk" ? "" : `<div class="sslab ${TW.sslab}">Actions</div><div class="ssacts in-[.ss-body]:flex in-[.ss-body]:flex-wrap in-[.ss-body]:gap-1.5">${act("split", "Split")}${act("dup", "Duplicate")}${act("freeze", "Freeze")}${act("delete", "Delete", st.edit.length < 2 ? " disabled" : "")}`
      + `<button type="button" class="ssact ${TW.ssact}" data-other="1">${sign("other")}<span>Other moment</span></button>`
 + `</div>`;
    const pick = true; // as on the phone: only what was tapped (Transition, Effect or Speed), not every tool at once
    const shot = "Shot " + String(i + 1).padStart(2, "0"); setText($("ssfoot"), "Preview selection · " + shot);
    return `<div class="ssh in-[.ss-body]:flex in-[.ss-body]:items-center in-[.ss-body]:gap-2.5 in-[.ss-body]:pr-10 in-[.ss-body]:[&_b]:[font:600_15.5px_var(--body)] in-[.ss-body]:[&_b]:flex-1 in-[.ss-body]:[&_b]:min-w-0 in-[.ss-body]:cursor-move in-[.ss-body]:[touch-action:none] in-[.brs.sheeton_#shotsheet]:pr-11.5! max-[680px]:in-[.brs.sheeton_#shotsheet]:pr-10! max-[680px]:in-[.brs.sheeton_#shotsheet]:gap-2 sheetHeader ${TW.sheetHeader}"><span class="sheetHeading ${TW.sheetHeading}"><span class="sheetIcon ${TW.sheetIcon}">${Glyph(names[Math.min(shotTab, 2)], 18)}</span><span><small>${shot.toUpperCase()} · ${(e.end - e.start).toFixed(2)} S</small><b>${names[Math.min(shotTab, 2)]}</b></span></span><span class="ssnav in-[.ss-body]:inline-flex in-[.ss-body]:gap-1 in-[.ss-body]:[&_button]:w-7.5 in-[.ss-body]:[&_button]:h-7.5 in-[.ss-body]:[&_button]:rounded-[9px] in-[.ss-body]:[&_button]:border in-[.ss-body]:[&_button]:border-border in-[.ss-body]:[&_button]:bg-surface-2 in-[.ss-body]:[&_button]:text-foreground in-[.ss-body]:[&_button]:[font:600_16px/1_var(--body)] in-[.ss-body]:[&_button]:cursor-pointer in-[.ss-body]:[&_button:disabled]:opacity-35 in-[.ss-body]:[&_button:disabled]:cursor-default in-[#shotsheet]:flex in-[#shotsheet]:gap-1.5 in-[#shotsheet]:ml-auto in-[#shotsheet]:[&_button]:w-8.5 in-[#shotsheet]:[&_button]:h-8.5 in-[#shotsheet]:[&_button]:grid in-[#shotsheet]:[&_button]:place-items-center in-[#shotsheet]:[&_button]:text-muted in-[#shotsheet]:[&_button]:border in-[#shotsheet]:[&_button]:border-[color:var(--ed-line)] in-[#shotsheet]:[&_button]:rounded-[11px] in-[#shotsheet]:[&_button]:bg-surface-2 in-[#shotsheet]:[&_button]:text-[18px] in-[#shotsheet]:[&_button]:cursor-pointer in-[#shotsheet]:[&_button:disabled]:opacity-40 in-[#shotsheet]:[&_button:disabled]:cursor-default max-[680px]:in-[#shotsheet]:[&_button]:w-7.5 max-[680px]:in-[#shotsheet]:[&_button]:h-7.5"><button type="button" data-snav="-1" aria-label="The shot before"${i ? "" : " disabled"}>‹</button><button type="button" data-snav="1" aria-label="The next shot"${i < st.edit.length - 1 ? "" : " disabled"}>›</button></span></div>`
      + `<p class="sheetDescription ${TW.sheetDescription}">Choose an option for your Reel. Your selection is ready to preview.</p>`
      + (shotTab < 2 ? tiles(shotTab) : shotTab === 2 ? speed : "") + (pick ? "" : (shotTab < 2 ? speed : "") + actions
      + (st.kind === "talk" ? "" : `<div class="sslab ${TW.sslab}">Clip Tools <small>(scroll)</small></div><div class="cliptools ${TW.cliptools}"></div>`));
  };
  // the clip tools (rotate, fit, adjust, mosaic…): drawn again when the shot's settings change, never during a slider drag
  const clipUI = (force = false) => {
    const st = S(), boxes = root.querySelectorAll<HTMLElement>("#shotcard .cliptools, #inspector .cliptools, #ssbody .cliptools"); if (!st || !boxes.length) return;
    if (!force && root.querySelector(".cliptools input[type=range]:focus")) return;
    const c = st.shotCs(); if (!c) return;
    const key = JSON.stringify(c) + ctOpen; if (!force && key === ctKey) return; ctKey = key;
    boxes.forEach((b) => { b.innerHTML = clipToolsHtml(c, ctOpen); });
  };
  const forward = (c: number, v: string) => { const st = S(); if (!st) return; const s = rowOf(st.segAt(st.now))?.children[c + 3]?.querySelector("select") as HTMLSelectElement | null; if (s && s.value !== v) { s.value = v; s.dispatchEvent(new Event("change")); } };
  const other = () => { const st = S(); if (!st) return; rowOf(st.segAt(st.now))?.children[2]?.querySelector<HTMLButtonElement>("button")?.click(); };
  for (const id of ["shotcard", "inspector", "ssbody"]) {
    $(id).addEventListener("click", (e) => { const t = e.target as HTMLElement; const c = t.closest<HTMLButtonElement>(".chip"), tb = t.closest<HTMLButtonElement>(".shtab");
      if (c && c.dataset.c) forward(+c.dataset.c, c.dataset.v!); else if (tb) { shotTab = +tb.dataset.tab!; shotKey = ""; } else if (t.closest("[data-other]")) other();
      else { const op = t.closest<HTMLButtonElement>("[data-op]"); if (op) { S()?.shotOp(op.dataset.op as "split" | "dup" | "delete" | "freeze"); shotKey = ""; } } }, sig);
    clipToolsEvents($(id), () => S(), () => ctOpen, (k) => { ctOpen = k; }, () => clipUI(true), sig);
    $(id).addEventListener("change", (e) => { const s = e.target as HTMLSelectElement; if (s.dataset.c) forward(+s.dataset.c, s.value);
      else if (s.dataset.rep && s.value !== "") { S()?.shotOp("replace", +s.value); shotKey = ""; } }, sig);
  }

  // the multi-track timeline (video with keyframes, text, voice, music), phones and computers, like CapCut / VN:
  // - zoom: a pinch (two fingers on a phone, the touchpad on a computer); swipe sideways to move along it
  // - drag a shot's right edge: the shot gets longer or shorter and every shot after it moves with it (shotRipple)
  // - tap: the playhead goes there; while playing the view follows the playhead
  const lanes = $<HTMLCanvasElement>("lanes");
  const css = (v: string, d: string) => getComputedStyle(root).getPropertyValue(v).trim() || d;
  const ZMAX = 40, RUL = 18, EDGE = 12; // the most zoom, the time ruler's height, how near an edge counts (css px)
  let zoom = 1, t0 = 0; // the view: the song from t0, a 1/zoom part of it
  let trim: Trim | null = null; // a shot's end (or, on a phone, its start) being dragged
  const labW = () => (lanes.clientWidth > 700 ? 132 : 104); // the tracks' heads: icon, name, a round + (as the design, phones too)
  // the song's loudness, measured once per song part: the louder of its samples every 5 ms (the waveform under the beats)
  const PEAK_DT = 0.005;
  let peaksOf: AudioBuffer | null = null, peaks = new Float32Array(0);
  const songPeaks = (a: AudioBuffer) => {
    if (a === peaksOf) return peaks;
    const ch = [...Array(a.numberOfChannels)].map((_, c) => a.getChannelData(c)), per = Math.max(1, Math.round(a.sampleRate * PEAK_DT));
    const n = Math.ceil(a.length / per), out = new Float32Array(n);
    let top = 1e-6;
    for (let k = 0; k < n; k++) { let m = 0; const e = Math.min(a.length, (k + 1) * per); for (let s = k * per; s < e; s += 2) for (const d of ch) { const v = Math.abs(d[s]); if (v > m) m = v; } out[k] = m; if (m > top) top = m; }
    for (let k = 0; k < n; k++) out[k] /= top;
    peaksOf = a; peaks = out; return out;
  };
  const span = () => (S()?.dur || 1) / zoom;
  // phones, as VN: the playhead stands in the middle of the tracks and the Reel slides under it (a swipe scrubs)
  const vn = () => !wide();
  const centre = () => { if (!vn()) return; const st = S(); if (st) t0 = st.now - span() / 2; };
  const fix = () => {
    const D = S()?.dur || 1; zoom = Math.max(vn() ? 0.6 : 1, Math.min(ZMAX, zoom)); if (vn()) centre(); else t0 = Math.max(0, Math.min(D - D / zoom, t0)); lanesKey = "";
    setText($("tlz"), Math.round((zoom / (vn() ? Math.max(1, D / 6) : 1)) * 100) + "%"); // 100% = the view it opens with (a phone: 6 s)
  };
  // − / + : half or twice the zoom, around the playhead
  const zoomBy = (f: number) => { const st = S(); if (!st) return; const at = Math.min(Math.max(st.now, t0), t0 + span()), p = (at - t0) / span(); zoom *= f; fix(); t0 = at - p * span(); fix(); };
  $("tlzi").addEventListener("click", () => zoomBy(2), sig);
  $("tlzo").addEventListener("click", () => zoomBy(0.5), sig);
  $("tlfit").addEventListener("click", () => { zoom = 1; t0 = 0; fix(); }, sig);
  // the preview full screen (the browser's own; Escape leaves it)
  $("pvfull").addEventListener("click", () => { const box = root.querySelector<HTMLElement>(".pvbox"); if (document.fullscreenElement) void document.exitFullscreen(); else void box?.requestFullscreen?.().catch(() => {}); }, sig);
  const tAt = (x: number) => { centre(); const r = lanes.getBoundingClientRect(), lab = labW(); return t0 + ((x - r.left - lab) / (r.width - lab)) * span(); };
  const xOf = (t: number) => { centre(); const r = lanes.getBoundingClientRect(), lab = labW(); return r.left + lab + ((t - t0) / span()) * (r.width - lab); };
  // the shot whose right edge is under x on the video track (not the last: it ends with the song)
  // the tracks from the top (css px): the ruler, Effects, Video, Text, Voice, Music
  const FXH = 28, GAP = 6, VTOP = RUL + FXH + GAP;
  // the tracks' heights (css px): video, text, voice, music; phones get tall ones, easy to hit with a finger (as VN)
  const ROWS = () => (lanes.clientWidth > 700 ? [46, 32, 32, 42] : [56, 30, 30, 48]);
  const vidH = () => ROWS()[0];
  // phones: a tap selects a clip (its toolbar opens under the timeline); a second tap on it opens its picker
  let phoneZoomed = false, sel = -1, move: { from: number; x: number } | null = null, press: { k: number; x: number; y: number; tm: ReturnType<typeof setTimeout> } | null = null;
  // the timeline's taps work as on the phone on every screen (a tap selects a clip and shows its toolbar, a second tap opens its picker)
  const phone = () => true;
  // the names people see for a transition and an effect: the edit list's own choices
  let namesGen = -1, names = { tr: new Map<string, string>(), efx: new Map<string, string>() };
  const nameOf = (kind: "tr" | "efx", v: string) => {
    const st = S();
    if (st && st.editGen !== namesGen) {
      namesGen = st.editGen;
      const row = rowOf(0), opts = (c: number) => new Map([...((row?.children[c + 3]?.querySelector("select") as HTMLSelectElement | null)?.options ?? [])].map((o) => [o.value, o.text] as [string, string]));
      names = { tr: opts(0), efx: opts(1) };
    }
    return names[kind].get(v) || v.charAt(0).toUpperCase() + v.slice(1);
  };
  // what is under the pointer, said in words (the canvas's tooltip)
  const infoAt = (x: number, y: number) => {
    const st = S(), r = lanes.getBoundingClientRect(), yy = y - r.top; if (!st) return "";
    const k = st.edit.findIndex((e) => xOf(e.start) <= x && x < xOf(e.end)); if (k < 0) return "";
    const e = st.edit[k];
    if (yy >= RUL && yy < RUL + FXH) return e.efx && e.efx !== "none" ? "Effect: " + nameOf("efx", e.efx) : e.ak && e.ak.length ? "Camera move (Shubix keyframes)" : "";
    if (yy >= VTOP && yy < VTOP + vidH()) {
      const near = st.edit.findIndex((s, j) => j > 0 && Math.abs(xOf(s.start) - x) < 10);
      if (near > 0 && st.edit[near].tr && st.edit[near].tr !== "hard") return "Transition: " + nameOf("tr", st.edit[near].tr);
      return "Shot " + (k + 1) + " · " + (e.end - e.start).toFixed(2) + " s" + (e.sp && e.sp.label !== "1×" ? " · speed " + e.sp.label : "") + (e.acc && e.acc.length ? " · " + e.acc.length + " hit" + (e.acc.length > 1 ? "s" : "") + " on the beat" : "");
    }
    return "";
  };
  // what a tap opens: a transition (on the cut, the shot it leads into), an effect (its box) or a speed (its badge)
  const hitAt = (x: number, y: number): { k: number; tab: number } | null => {
    const st = S(), r = lanes.getBoundingClientRect(), yy = y - r.top; if (!st) return null;
    if (yy >= VTOP && yy < VTOP + vidH()) {
      const c = st.edit.findIndex((s, j) => j > 0 && s.tr && s.tr !== "hard" && Math.abs(xOf(s.start) - x) < 11 && yy < VTOP + 22);
      if (c > 0) return { k: c, tab: 0 };
    }
    const k = st.edit.findIndex((e) => xOf(e.start) <= x && x < xOf(e.end)); if (k < 0) return null;
    const e = st.edit[k];
    if (yy >= RUL && yy < RUL + FXH && ((e.efx && e.efx !== "none") || (e.ak && e.ak.length))) return { k, tab: 1 };
    if (yy >= VTOP + vidH() - 18 && yy < VTOP + vidH() && e.sp && e.sp.label !== "1×" && x < Math.max(xOf(e.start), r.left + labW()) + 90) return { k, tab: 2 };
    return null;
  };
  const edgeAt = (x: number, y: number) => {
    const st = S(), r = lanes.getBoundingClientRect(), vh = vidH();
    // the lower part of the video track (the handle is drawn there; the upper part of a cut is its transition box)
    if (!st || y - r.top < VTOP + vh * 0.45 || y - r.top > VTOP + vh) return -1;
    let best = -1, bd = EDGE;
    st.edit.forEach((e, k) => { const d = Math.abs(xOf(e.end) - x); if (k < st.edit.length - 1 && d < bd && (!phone() || k === sel)) { bd = d; best = k; } });
    return best;
  };
  const drawLanes = () => {
    const st = S(); if (!st || !made() || !st.edit.length || !lanes.clientWidth) return;
    const D = st.dur || 1, now = st.now;
    // a phone opens the tracks zoomed in (about 12 s across, as VN): every clip wide enough to see and to tap
    if (vn() && editing && !phoneZoomed) { phoneZoomed = true; zoom = Math.max(1, D / 6); fix(); }
    if (vn()) centre();
    else if (st.playing && (now < t0 || now > t0 + span())) { t0 = now - span() * 0.1; fix(); } // follow the playhead
    const key = [lanes.clientWidth, zoom, t0, sel, st.ovSel, ovDrag ? ovDrag.i + ":" + st.overlays[ovDrag.i]?.t0 + ":" + st.overlays[ovDrag.i]?.t1 : "", (st.sources[0]?.strip?.length ?? 0), move ? move.from + ":" + Math.round(move.x) : "", (root.querySelector<HTMLInputElement>("#mvol")?.value ?? ""), st.audio ? st.audio.length : 0, st.beats.length, trim ? trim.i + ":" + trim.to : "", st.editGen, st.edit.length, (now * 20) | 0, st.overlays.map((o) => o.t0 + "/" + o.t1 + o.text).join(), !!st.vo, st.hook, st.capsOn, st.edit.reduce((a, e) => a + (e.uk ? e.uk.length : 0), 0), root.querySelectorAll("#edl tr").length].join("|");
    if (key === lanesKey) return; lanesKey = key;
    const dpr = window.devicePixelRatio || 1, wide = lanes.clientWidth > 700, lab = labW() * dpr;
    const rows = ROWS().map((h) => h * dpr), gap = GAP * dpr, rul = RUL * dpr;
    const fxh = FXH * dpr, W = Math.round(lanes.clientWidth * dpr), H = Math.round(rul + fxh + gap + rows.reduce((a, b) => a + b, 0) + gap * 3);
    if (lanes.width !== W) lanes.width = W; if (lanes.height !== H) { lanes.height = H; lanes.style.height = H / dpr + "px"; }
    const g = lanes.getContext("2d")!; g.clearRect(0, 0, W, H);
    const ink = css("--foreground", "#f6f4ff"), muted = css("--muted", "#a3a1c9"), acc = css("--accent", "#b05cff"), chip = css("--surface-2", "#1c1c3f");
    const pps = (W - lab) / (D / zoom); // pixels per second
    const X = (t: number) => lab + (t - t0) * pps;
    g.font = `${11 * dpr}px system-ui, sans-serif`; g.textBaseline = "middle";
    const track = (draw: () => void) => { g.save(); g.beginPath(); g.rect(lab, 0, W - lab, H); g.clip(); draw(); g.restore(); };
    // the ruler: a tick every 0.25 s to 1 min, as many as fit
    const step = [0.25, 0.5, 1, 2, 5, 10, 30, 60].find((s) => s * pps >= 56 * dpr) ?? 60;
    // the ruler, as the design: "TRACKS" over the heads, then 00:05 marks over a hairline
    const mmss = (t: number) => String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(Math.floor(t % 60)).padStart(2, "0");
    const line = css("--border", "rgba(0,0,0,.12)");
    g.font = `800 ${8.5 * dpr}px system-ui, sans-serif`; g.fillStyle = muted; g.fillText("T R A C K S", 8 * dpr, rul / 2);
    g.fillStyle = line; g.fillRect(lab, rul - dpr, W - lab, dpr);
    g.font = `600 ${9.5 * dpr}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    track(() => { g.fillStyle = muted; for (let t = Math.max(0, Math.floor(t0 / step) * step); t <= Math.min(D, t0 + D / zoom + step); t += step) { if (X(t) < lab) continue; g.fillRect(X(t), rul - 6 * dpr, dpr, 6 * dpr); g.fillText(step < 1 ? fmt(t) : mmss(t), X(t) + 3 * dpr, rul / 2 - dpr); } });
    g.font = `${11 * dpr}px system-ui, sans-serif`;
    let y = rul;
    // a line sign from the design's set (markup.ts GLYPH_PATHS), drawn at s css px
    const glyph = (name: string, x: number, cy: number, s: number, col: string) => {
      const d = GLYPH_PATHS[name]; if (!d) return;
      g.save(); g.translate(x, cy - (s * dpr) / 2); g.scale((s * dpr) / 24, (s * dpr) / 24);
      g.strokeStyle = col; g.lineWidth = 1.8; g.lineCap = "round"; g.lineJoin = "round"; g.stroke(new Path2D(d)); g.restore();
    };
    const SIGN_OF: Record<string, string> = { Effects: "Effect", Video: "Shots", Text: "Text", Voice: "Voice", Music: "Music" };
    // a track's head: its sign and name, and a round + on a computer (a tap there adds to that track: see laneTap)
    const label = (s: string, h: number, _sign = "") => {
      const my = y + h / 2;
      g.fillStyle = chip; rr(lab, y + dpr, W - lab, h - 2 * dpr, 6 * dpr); g.fill(); // the track's lane, under its clips
      if (lab >= 90 * dpr) {
        const plusX = lab - 20 * dpr, spkX = plusX - 30 * dpr; // the round + at the right of the head, the speaker before it
        g.fillStyle = line; g.fillRect(8 * dpr, y + h, lab - 16 * dpr, dpr); // the heads' rule
        glyph(SIGN_OF[s] ?? "Shots", 8 * dpr, my, 14, acc);
        g.font = `500 ${11.5 * dpr}px system-ui, sans-serif`; g.fillStyle = ink; g.fillText(s, 30 * dpr, my, (s === "Music" ? spkX : plusX - 12 * dpr) - 32 * dpr);
        if (s === "Music") { const off = muted0(); glyph("Volume", spkX, my, 13, off ? "#d9534f" : muted); if (off) { g.fillStyle = "#d9534f"; g.fillRect(spkX, my - 0.5 * dpr, 14 * dpr, 1.5 * dpr); } }
        const cx = plusX, r = (wide ? 9 : 8) * dpr; // the round +
        g.beginPath(); g.arc(cx, my, r, 0, 7); g.fillStyle = css("--surface", "#fff"); g.fill(); g.lineWidth = dpr; g.strokeStyle = line; g.stroke();
        g.fillStyle = muted; g.fillRect(cx - 4 * dpr, my - 0.6 * dpr, 8 * dpr, 1.2 * dpr); g.fillRect(cx - 0.6 * dpr, my - 4 * dpr, 1.2 * dpr, 8 * dpr);
      } else {
        // a phone's narrow heads: the name only
        g.font = `600 ${10.5 * dpr}px system-ui, sans-serif`; g.fillStyle = ink; g.fillText(s, 4 * dpr, s === "Music" ? my - 8 * dpr : my, lab - 6 * dpr);
        if (s === "Music") { const off = muted0(); g.font = `600 ${12 * dpr}px system-ui, sans-serif`; g.fillStyle = off ? "#ff6a7a" : acc; g.fillText(off ? "🔇 Off" : "🔊 On", 4 * dpr, my + 9 * dpr); }
      }
      g.font = `${11 * dpr}px system-ui, sans-serif`;
    };
    const rr = (x: number, yy: number, w: number, h: number, r: number) => { g.beginPath(); if (g.roundRect) g.roundRect(x, yy, Math.max(1, w), h, r); else g.rect(x, yy, Math.max(1, w), h); };
    const cur = phone() ? sel : st.segAt(now), dt = trim && !trim.left ? trim.to - st.edit[trim.i].end : 0;
    // where each shot is drawn: while an end is dragged that shot stretches and the shots after it move with it; while a
    // start is dragged (a phone) the cut moves: the shot before ends there, this one starts there
    const at = (k: number) => { const e = st.edit[k];
      if (trim && trim.left) return [k === trim.i ? trim.to : e.start, k === trim.i - 1 ? trim.to : e.end];
      const sh = trim && k > trim.i ? dt : 0; return [e.start + sh, trim && k === trim.i ? trim.to : e.end + sh]; };
    // a small box with a word in it (an effect, a speed), as the pro editors show them on their tracks
    const tag = (x: number, yy: number, maxW: number, h: number, text: string, bg: string, fg = "#fff") => {
      g.font = `600 ${10.5 * dpr}px system-ui, sans-serif`;
      // too narrow for its word (zoomed out, a short shot): a thin bar of its colour; zoom in for the name
      if (maxW < 44 * dpr) { if (maxW > 4 * dpr) { g.fillStyle = bg; rr(x, yy + h / 2 - 2 * dpr, maxW, 4 * dpr, 2 * dpr); g.fill(); } g.font = `${11 * dpr}px system-ui, sans-serif`; return; }
      const w = Math.min(maxW, g.measureText(text).width + 12 * dpr);
      g.fillStyle = bg; rr(x, yy, w, h, 4 * dpr); g.fill();
      g.save(); g.beginPath(); g.rect(x, yy, w, h); g.clip(); g.fillStyle = fg; g.fillText(text, x + 6 * dpr, yy + h / 2 + 0.5 * dpr); g.restore();
      g.font = `${11 * dpr}px system-ui, sans-serif`;
    };
    const diamond = (x: number, yy: number, r: number, col: string) => { g.beginPath(); g.moveTo(x, yy - r); g.lineTo(x + r, yy); g.lineTo(x, yy + r); g.lineTo(x - r, yy); g.closePath(); g.fillStyle = col; g.fill(); g.lineWidth = dpr; g.strokeStyle = "rgba(0,0,0,.45)"; g.stroke(); };
    // Effects: each shot's effect (or Shubix's camera move) as a box across its shot
    label("Effects", fxh, "✦");
    track(() => st.edit.forEach((e, k) => {
      const [a, b] = at(k), x0 = X(a) + 2 * dpr, w = X(b) - X(a) - 4 * dpr;
      if (e.efx && e.efx !== "none") tag(x0, y + 2 * dpr, w, fxh - 4 * dpr, "✦ " + nameOf("efx", e.efx), acc);
      else if (e.ak && e.ak.length) tag(x0, y + 2 * dpr, w, fxh - 4 * dpr, "◆ Camera move", "#7d6a52");
    }));
    y += fxh + gap;
    label("Video", rows[0], "▣");
    track(() => st.edit.forEach((e, k) => {
      const [a, b] = at(k), x0 = X(a) + dpr, x1 = X(b) - dpr, h = rows[0];
      g.fillStyle = CLIP_COL[e.src % CLIP_COL.length]; rr(x0, y, x1 - x0, h, 5 * dpr); g.fill();
      // a film strip: the clip's picture, again and again along the shot (as the editors show it)
      const th = st.sources[e.src]?.card?.querySelector<HTMLCanvasElement>(".th"), strip = st.sources[e.src]?.strip;
      if (strip && strip.length && x1 - x0 > 6 * dpr) {
        // as VN: the clip's frames one after another, each the moment of the clip under it
        g.save(); rr(x0, y, x1 - x0, h, 5 * dpr); g.clip();
        const c0 = strip[0].c, tw = Math.max(18 * dpr, h * (c0.width / c0.height));
        for (let tx = x0; tx < x1 && tx < W; tx += tw) { if (tx + tw <= lab) continue;
          const ts = (e.in ?? 0) + ((tx + tw / 2 - X(a)) / pps) * (e.scaleR ?? 1);
          let lo = 0, hi = strip.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (strip[m].t < ts) lo = m + 1; else hi = m; }
          const f = lo > 0 && Math.abs(strip[lo - 1].t - ts) < Math.abs(strip[lo].t - ts) ? strip[lo - 1] : strip[lo];
          g.drawImage(f.c, tx, y, tw, h); }
        g.fillStyle = "rgba(0,0,0,.18)"; g.fillRect(x0, y, x1 - x0, h);
        g.restore();
      } else if (th && th.width && x1 - x0 > 6 * dpr) {
        g.save(); rr(x0, y, x1 - x0, h, 5 * dpr); g.clip();
        const tw = h * 0.75, sw = Math.min(th.width, th.height * 0.75), sx = (th.width - sw) / 2;
        for (let tx = x0; tx < x1 && tx < W; tx += tw) if (tx + tw > lab) g.drawImage(th, sx, 0, sw, th.height, tx, y, tw, h);
        g.fillStyle = "rgba(0,0,0,.28)"; g.fillRect(x0, y, x1 - x0, h);
        g.restore();
      }
      if (k === cur || (trim && k === trim.i)) { g.lineWidth = 2 * dpr; g.strokeStyle = acc; g.stroke(); }
      // as the design: where the shot starts in a small dark chip at the top left, a play mark at the bottom right
      const vis = x1 - Math.max(x0, lab);
      if (vis > 24 * dpr) { g.save(); rr(x0, y, x1 - x0, h, 5 * dpr); g.clip();
        const lx = Math.max(x0, lab) + 4 * dpr, txt = vis > 44 * dpr ? mmss(a) : String(k + 1);
        g.font = `700 ${8.5 * dpr}px ui-monospace, SFMono-Regular, Menlo, monospace`; const tw = g.measureText(txt).width + 8 * dpr;
        g.fillStyle = "rgba(0,0,0,.42)"; rr(lx, y + 4 * dpr, tw, 13 * dpr, 4 * dpr); g.fill(); g.fillStyle = "#fff"; g.fillText(txt, lx + 4 * dpr, y + 10.5 * dpr);
        if (vis > 56 * dpr && x1 - 14 * dpr > lab) { const px = x1 - 12 * dpr, py = y + h - 11 * dpr; g.beginPath(); g.moveTo(px, py - 4 * dpr); g.lineTo(px + 6 * dpr, py); g.lineTo(px, py + 4 * dpr); g.closePath(); g.fillStyle = "rgba(255,255,255,.9)"; g.fill(); }
        g.font = `${11 * dpr}px system-ui, sans-serif`; g.restore(); }
      // speed: a small box at the bottom left
      if (e.sp && e.sp.label && e.sp.label !== "1×" && x1 - Math.max(x0, lab) > 56 * dpr) tag(Math.max(x0, lab) + 4 * dpr, y + h - 16 * dpr, x1 - Math.max(x0, lab) - 8 * dpr, 13 * dpr, "⏱ " + e.sp.label, "rgba(0,0,0,.55)");
      // keyframes: yours (light blue), Shubix's camera moves (violet), the hits on the beat (gold)
      const ky = y + h - 8 * dpr, r = 4 * dpr;
      for (const q of e.ak || []) diamond(X(a + q.t), ky, r, "#e3cfa4");
      for (const q of e.acc || []) diamond(X(a + q.at), y + 9 * dpr, r, "#f2bb1d");
      for (const q of e.uk || []) diamond(X(a + q.t), ky, r, "#6FA8FF");
      // the handle on the right edge (the last shot ends with the song)
      if (vn() && k === sel) {
        g.lineWidth = 3 * dpr; g.strokeStyle = "#fff"; rr(x0, y - dpr, x1 - x0, h + 2 * dpr, 5 * dpr); g.stroke();
        const hw = 10 * dpr; lanes.dataset.selx = Math.round(x0 / dpr) + "," + Math.round(x1 / dpr);
        if (k > 0) { g.fillStyle = "#fff"; rr(x0 - hw + 2 * dpr, y - dpr, hw, h + 2 * dpr, 4 * dpr); g.fill(); g.fillStyle = "#555"; g.fillRect(x0 - hw / 2 - dpr, y + h * 0.35, 2 * dpr, h * 0.3); }
        if (k < st.edit.length - 1) { g.fillStyle = "#fff"; rr(x1 - 2 * dpr, y - dpr, hw, h + 2 * dpr, 4 * dpr); g.fill(); g.fillStyle = "#555"; g.fillRect(x1 + hw / 2 - 3 * dpr, y + h * 0.35, 2 * dpr, h * 0.3); }
      } else if (k < st.edit.length - 1 && (k === cur || (trim && k === trim.i))) { g.fillStyle = "#fff"; rr(x1 - 5 * dpr, y + h * 0.52, 4 * dpr, h * 0.4, 2 * dpr); g.fill(); }
    }));
    // transitions: a small box on the cut (a bow tie: one shot into the next), named on hover
    track(() => st.edit.forEach((e, k) => {
      if (!k || !e.tr || e.tr === "hard") return;
      const cx = X(at(k)[0]), s = 16 * dpr, top = y + 3 * dpr; // the upper half: the trim handle is in the lower one
      // shots too short for a box (zoomed out): a dot on the cut instead
      const room = Math.min(X(at(k)[1]) - X(at(k)[0]), X(at(k - 1)[1]) - X(at(k - 1)[0]));
      if (room < 30 * dpr) { g.fillStyle = "#fff"; g.beginPath(); g.arc(cx, top + s / 2, 2.5 * dpr, 0, 7); g.fill(); return; }
      g.fillStyle = "#fff"; rr(cx - s / 2, top, s, s, 4 * dpr); g.fill(); g.lineWidth = dpr; g.strokeStyle = "rgba(0,0,0,.35)"; g.stroke();
      g.fillStyle = acc; g.beginPath(); g.moveTo(cx - 5 * dpr, top + 4 * dpr); g.lineTo(cx, top + s / 2); g.lineTo(cx - 5 * dpr, top + s - 4 * dpr); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(cx + 5 * dpr, top + 4 * dpr); g.lineTo(cx, top + s / 2); g.lineTo(cx + 5 * dpr, top + s - 4 * dpr); g.closePath(); g.fill();
    }));
    if (trim && dt > 0) track(() => { g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(X(D), y, W, rows[0]); }); // past the song's end: cut
    if (vn()) track(() => { const bx = X(D) + 10 * dpr, s = rows[0] - 12 * dpr; if (bx > W) return; g.fillStyle = "#fff"; rr(bx, y + 6 * dpr, s, s, 8 * dpr); g.fill();
      g.fillStyle = "#111"; g.fillRect(bx + s / 2 - 1.5 * dpr, y + 6 * dpr + s * 0.28, 3 * dpr, s * 0.44); g.fillRect(bx + s * 0.28, y + 6 * dpr + s / 2 - 1.5 * dpr, s * 0.44, 3 * dpr); });
    if (move && st.edit[move.from]) {
      const e = st.edit[move.from], h = rows[0], to = dropAt(move.x), px = (move.x - lanes.getBoundingClientRect().left) * dpr;
      track(() => { const lx = X(st.edit[to].start) + (to > move!.from ? X(st.edit[to].end) - X(st.edit[to].start) : 0); g.fillStyle = "#fff"; g.fillRect(lx - 1.5 * dpr, y - 4 * dpr, 3 * dpr, h + 8 * dpr); });
      const w = Math.max(40 * dpr, Math.min(110 * dpr, X(e.end) - X(e.start))), gx = Math.max(lab, Math.min(W - w, px - w / 2));
      g.save(); g.globalAlpha = 0.92; g.shadowColor = "rgba(0,0,0,.5)"; g.shadowBlur = 12 * dpr; g.fillStyle = CLIP_COL[e.src % CLIP_COL.length]; rr(gx, y - 6 * dpr, w, h + 12 * dpr, 7 * dpr); g.fill(); g.restore();
      const th = st.sources[e.src]?.card?.querySelector<HTMLCanvasElement>(".th");
      if (th && th.width) { g.save(); rr(gx, y - 6 * dpr, w, h + 12 * dpr, 7 * dpr); g.clip(); g.drawImage(th, gx, y - 6 * dpr, w, h + 12 * dpr); g.restore(); }
      g.lineWidth = 2.5 * dpr; g.strokeStyle = acc; rr(gx, y - 6 * dpr, w, h + 12 * dpr, 7 * dpr); g.stroke();
    }
    y += rows[0] + gap;
    const bar = (a: number, b: number, s: string, col: string, h: number) => track(() => { const x0 = X(a), x1 = X(b); g.fillStyle = col; rr(x0, y + dpr, x1 - x0, h - 2 * dpr, 5 * dpr); g.fill(); g.save(); g.beginPath(); g.rect(x0, y, x1 - x0, h); g.clip(); g.fillStyle = "#fff"; g.fillText(s, Math.max(x0, lab) + 6 * dpr, y + h / 2); g.restore(); });
    label("Text", rows[1], "T");
    if (st.hook) bar(0, Math.min(D, 2.2), "T  " + st.hook, "#9b7443", rows[1]);
    st.overlays.forEach((o, i) => { const a0 = o.all ? 0 : o.t0, b0 = o.all ? D : o.t1; bar(a0, b0, (o.emoji ? "" : "T  ") + o.text, acc, rows[1]);
      if (i === st.ovSel) track(() => { const xa = X(a0), xb = X(b0); g.lineWidth = 2.5 * dpr; g.strokeStyle = "#fff"; rr(xa, y + dpr, xb - xa, rows[1] - 2 * dpr, 5 * dpr); g.stroke();
        g.fillStyle = "#fff"; rr(xa - 3 * dpr, y + dpr, 7 * dpr, rows[1] - 2 * dpr, 3 * dpr); g.fill(); rr(xb - 4 * dpr, y + dpr, 7 * dpr, rows[1] - 2 * dpr, 3 * dpr); g.fill(); }); });
    if (st.capsOn) bar(Math.min(D, 2.4), D, "CC  Captions", "#6f5a3a", rows[1]);
    y += rows[1] + gap;
    label("Voice", rows[2], "◉");
    // the voice, as the design: a light teal band of short bars, its name on it
    if (st.vo || st.kind === "talk") track(() => { const h = rows[2], x0 = X(0), x1 = X(D), mid = y + h / 2;
      g.fillStyle = "rgba(95,148,136,.22)"; rr(x0, y + dpr, x1 - x0, h - 2 * dpr, 5 * dpr); g.fill(); g.lineWidth = dpr; g.strokeStyle = "rgba(95,148,136,.45)"; g.stroke();
      g.fillStyle = "rgba(95,148,136,.75)"; for (let px = Math.max(lab, x0) + 6 * dpr, i = 0; px < Math.min(W, x1) - 4 * dpr; px += 5 * dpr, i++) { const hh = (0.25 + Math.abs(Math.sin(i * 0.9) * Math.cos(i * 0.37)) * 0.6) * (h / 2 - 3 * dpr); g.fillRect(px, mid - hh, 2 * dpr, hh * 2); }
      g.font = `600 ${10 * dpr}px system-ui, sans-serif`; g.fillStyle = ink; g.fillText(st.kind === "talk" ? "Your voice · pauses cut" : "Voiceover", Math.max(x0, lab) + 6 * dpr, mid); g.font = `${11 * dpr}px system-ui, sans-serif`; });
    y += rows[2] + gap;
    label("Music", rows[3], "♫");
    if (st.songName && st.audio) {
      // the song as a waveform (louder = taller), its beats as marks, zoomed with every other track (they stay in sync)
      const h = rows[3], mid = y + h / 2, pk = songPeaks(st.audio);
      track(() => {
        // as the design: a warm band with a border, the song's loudness as thin spaced bars, the name at the top left
        g.fillStyle = chip; rr(X(0), y + dpr, X(D) - X(0), h - 2 * dpr, 5 * dpr); g.fill();
        g.save(); g.globalAlpha = 0.16; g.fillStyle = acc; g.fill(); g.restore(); g.lineWidth = dpr; g.strokeStyle = line; g.stroke();
        g.save(); g.globalAlpha = 0.6; g.fillStyle = acc;
        const bw = 2 * dpr, bs = 4 * dpr, wmid = mid + 4 * dpr, wh = h / 2 - 9 * dpr;
        for (let px = Math.max(lab, X(0)) + 2 * dpr; px < Math.min(W, X(D)) - bw; px += bs) {
          const a = Math.max(0, Math.floor((t0 + (px - lab) / pps) / PEAK_DT)), b = Math.min(pk.length, Math.ceil((t0 + (px + bs - lab) / pps) / PEAK_DT));
          let m = 0; for (let k = a; k < Math.max(b, a + 1) && k < pk.length; k++) if (pk[k] > m) m = pk[k];
          const hh = Math.max(dpr, m * wh); g.fillRect(px, wmid - hh, bw, hh * 2);
        }
        g.restore();
        g.fillStyle = acc;
        for (const bt of st.beats) if (bt >= t0 && bt <= t0 + D / zoom) g.fillRect(Math.round(X(bt)), y + h - 5 * dpr, dpr, 3 * dpr);
        g.font = `600 ${10 * dpr}px system-ui, sans-serif`;
        const nm = "♪ " + st.songName + (muted0() ? "  ·  muted" : ""), nx = Math.max(X(0), lab) + 6 * dpr, nw = Math.min(g.measureText(nm).width + 4 * dpr, W - nx - 4 * dpr);
        g.save(); g.beginPath(); g.rect(nx, y, nw, h); g.clip(); g.fillStyle = ink; g.fillText(nm, nx, y + 10 * dpr); g.restore();
        if (muted0()) { g.fillStyle = "rgba(0,0,0,.45)"; g.fillRect(Math.max(X(0), lab), y + dpr, X(D) - Math.max(X(0), lab), h - 2 * dpr); }
        g.font = `${11 * dpr}px system-ui, sans-serif`;
      });
    } else if (st.songName) bar(0, D, "♪ " + st.songName, "#8a6a3f", rows[3]);
    else track(() => { g.fillStyle = chip; rr(lab, y + dpr, W - lab, rows[3] - 2 * dpr, 5 * dpr); g.fill(); });
    // the playhead: a line through every track and a marker on the ruler
    if (now >= t0 && now <= t0 + D / zoom) {
      // as the design: a thin line through every track with a dot on the ruler
      const px = Math.round(X(now)); g.fillStyle = css("--accent-hover", acc); g.fillRect(px - 0.75 * dpr, rul - 6 * dpr, 1.5 * dpr, H);
      g.beginPath(); g.arc(px, rul - 6 * dpr, 4 * dpr, 0, 7); g.fill();
    }
  };
  window.addEventListener("resize", () => { lanesKey = ""; if (wide() && !tool && made()) { tool = defTool(); apply(); } const st = S() as (Studio & { drawTimeline?: () => void }) | undefined; if (st && st.edit.length) st.drawTimeline?.(); }, sig);
  // fingers and the mouse: one pointer drags an edge, moves along (when zoomed) or taps; two pointers pinch
  const pts = new Map<number, number>(); // pointer id -> x
  let pinch: { d0: number; z0: number; tm: number; f: number } | null = null, pan: { x: number; t0: number; now: number; moved: boolean; vx: number; lt: number; lx: number } | null = null;
  const spread = () => { const xs = [...pts.values()]; return { d: Math.abs(xs[0] - xs[1]) || 1, m: (xs[0] + xs[1]) / 2 }; };
  const pxs = () => { const r = lanes.getBoundingClientRect(); return (r.width - labW()) / span(); }; // css px per second
  // phones: a swipe on the tracks scrubs (the Reel slides under the playhead in the middle), one seek per frame
  let scrubT: number | null = null, scrubRaf = 0, glide = 0;
  const scrub = (t: number) => { const st = S(); if (!st) return; scrubT = Math.max(0, Math.min(st.dur - 0.01, t));
    if (!scrubRaf) scrubRaf = requestAnimationFrame(() => { scrubRaf = 0; const s2 = S(); if (s2 && scrubT != null) { void s2.kfSeek(scrubT); lanesKey = ""; } }); };
  // a flick keeps going a little and slows down (as VN)
  const flick = (v: number) => { cancelAnimationFrame(glide); let vel = v, last = performance.now();
    const step = (now: number) => { const st = S(); if (!st) return; const dt = now - last; last = now; vel *= Math.pow(0.94, dt / 16);
      if (Math.abs(vel) < 0.02) return; scrub((scrubT ?? st.now) - (vel * dt) / pxs()); glide = requestAnimationFrame(step); };
    glide = requestAnimationFrame(step); };
  // a text on the Text track: drag it to move it in time, drag its ends to make it shorter or longer; a tap selects it
  let ovDrag: { i: number; part: "body" | "l" | "r"; x0: number; a: number; b: number; moved: boolean } | null = null;
  const ovAt = (x: number, y: number) => {
    const st = S(), r = lanes.getBoundingClientRect(), yy = y - r.top; if (!st) return null;
    const [vh, th] = ROWS(), top = VTOP + vh + GAP; if (yy < top || yy > top + th || x < r.left + labW()) return null;
    for (let i = st.overlays.length - 1; i >= 0; i--) { const o = st.overlays[i], a = o.all ? 0 : o.t0, b = o.all ? st.dur : o.t1, xa = xOf(a), xb = xOf(b);
      if (x < xa - 10 || x > xb + 10) continue;
      return { i, part: (i === st.ovSel && Math.abs(x - xa) < 14 ? "l" : i === st.ovSel && Math.abs(x - xb) < 14 ? "r" : "body") as "body" | "l" | "r", a, b }; }
    return null;
  };
  // the selected clip's start (phones: a handle at each end)
  const leftEdgeAt = (x: number, y: number) => {
    const st = S(), r = lanes.getBoundingClientRect(), yy = y - r.top; if (!st || !vn() || sel < 1 || !st.edit[sel]) return false;
    return yy >= VTOP - 4 && yy <= VTOP + vidH() + 4 && x <= xOf(st.edit[sel].start) + 6 && x >= xOf(st.edit[sel].start) - 18;
  };
  const rightEdgeAt = (x: number, y: number) => {
    const st = S(), r = lanes.getBoundingClientRect(), yy = y - r.top; if (!st || !vn() || sel < 0 || sel >= st.edit.length - 1) return false;
    return yy >= VTOP - 4 && yy <= VTOP + vidH() + 4 && x >= xOf(st.edit[sel].end) - 6 && x <= xOf(st.edit[sel].end) + 18;
  };
  const plusAt = (x: number, y: number) => { const st = S(), r = lanes.getBoundingClientRect(), yy = y - r.top; if (!st || !vn()) return false;
    const bx = xOf(st.dur) + 10; return yy >= VTOP && yy <= VTOP + vidH() && x >= bx && x <= bx + vidH(); };
  lanes.addEventListener("pointerdown", (e) => {
    const st = S(); if (!st || !st.dur) return;
    cancelAnimationFrame(glide);
    if (e.isPrimary) { pts.clear(); pinch = null; } // a new gesture: nothing left over from one that never ended
    try { lanes.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
    pts.set(e.pointerId, e.clientX);
    if (pts.size === 2) { const { d, m } = spread(), r = lanes.getBoundingClientRect(); trim = null; pan = null; ovDrag = null; if (press) { clearTimeout(press.tm); press = null; } move = null; pinch = { d0: d, z0: zoom, tm: tAt(m), f: (m - r.left - labW()) / (r.width - labW()) }; return; }
    if (leftEdgeAt(e.clientX, e.clientY)) { trim = { i: sel, to: st.edit[sel].start, left: true }; lanesKey = ""; return; }
    if (rightEdgeAt(e.clientX, e.clientY)) { trim = { i: sel, to: st.edit[sel].end }; lanesKey = ""; return; }
    const k = vn() ? -1 : edgeAt(e.clientX, e.clientY);
    if (k >= 0) { trim = { i: k, to: st.edit[k].end }; lanesKey = ""; return; }
    const oh = ovAt(e.clientX, e.clientY);
    if (oh) { ovDrag = { ...oh, x0: e.clientX, moved: false }; return; }
    pan = { x: e.clientX, t0, now: st.now, moved: false, vx: 0, lt: performance.now(), lx: e.clientX };
    const pk = st.kind === "talk" ? -1 : shotAt(e.clientX, e.clientY);
    if (pk >= 0 && st.edit.length > 1) { const x0 = e.clientX; press = { k: pk, x: x0, y: e.clientY, tm: setTimeout(() => { press = null; pan = null; move = { from: pk, x: x0 }; lanesKey = ""; try { navigator.vibrate?.(12); } catch { /* no vibration */ } }, 380) }; }
  }, sig);
  lanes.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) { lanes.style.cursor = edgeAt(e.clientX, e.clientY) >= 0 ? "col-resize" : hitAt(e.clientX, e.clientY) ? "pointer" : "default"; const t = infoAt(e.clientX, e.clientY); if (lanes.title !== t) lanes.title = t; return; }
    pts.set(e.pointerId, e.clientX);
    const st = S(); if (!st) return;
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) { clearTimeout(press.tm); press = null; }
    if (move) { move.x = e.clientX; lanesKey = ""; const r = lanes.getBoundingClientRect(); // near an end: the tracks scroll along
      const by = e.clientX < r.left + labW() + 24 ? -1 : e.clientX > r.right - 24 ? 1 : 0;
      if (by && vn()) scrub(st.now + by * span() * 0.03); else if (by) { t0 += by * span() * 0.03; fix(); }
      return; }
    if (pinch && pts.size === 2) { const { d } = spread(); zoom = pinch.z0 * (d / pinch.d0); fix(); if (!vn()) { t0 = pinch.tm - pinch.f * span(); fix(); } return; }
    if (ovDrag) { const o = st.overlays[ovDrag.i]; if (!o) return; const dt = (e.clientX - ovDrag.x0) / pxs(); if (Math.abs(e.clientX - ovDrag.x0) > 4) ovDrag.moved = true; if (!ovDrag.moved) return;
      const D = st.dur, len = ovDrag.b - ovDrag.a; o.all = false;
      if (ovDrag.part === "body") { const a = Math.max(0, Math.min(D - len, ovDrag.a + dt)); o.t0 = a; o.t1 = a + len; }
      else if (ovDrag.part === "l") o.t0 = Math.max(0, Math.min(ovDrag.b - 0.3, ovDrag.a + dt));
      else o.t1 = Math.max(ovDrag.a + 0.3, Math.min(D, ovDrag.b + dt));
      lanesKey = ""; return; }
    if (trim) { const i = trim.i;
      trim.to = trim.left ? Math.max(st.edit[i - 1].start + 0.3, Math.min(st.edit[i].end - 0.3, tAt(e.clientX))) : Math.max(st.edit[i].start + 0.3, Math.min(st.dur - 0.3, tAt(e.clientX)));
      lanesKey = ""; return; }
    if (pan) { const r = lanes.getBoundingClientRect(), dx = e.clientX - pan.x; if (Math.abs(dx) > 4) pan.moved = true;
      const now = performance.now(), dtm = Math.max(1, now - pan.lt); pan.vx = 0.7 * pan.vx + 0.3 * ((e.clientX - pan.lx) / dtm); pan.lt = now; pan.lx = e.clientX;
      if (vn()) { if (pan.moved) scrub(pan.now - dx / pxs()); }
      else { t0 = pan.t0 - (dx / (r.width - labW())) * span(); fix(); } }
  }, sig);
  const up = (e: PointerEvent) => {
    if (!pts.delete(e.pointerId)) return;
    const st = S();
    if (press) { clearTimeout(press.tm); press = null; }
    if (move) { const m = move; move = null; lanesKey = ""; pan = null; trim = null;
      if (st && e.type === "pointerup") { const to = dropAt(e.clientX); if (to !== m.from && st.shotMove(m.from, to)) { shotKey = ""; if (phone()) selectClip(to); } else if (phone()) selectClip(m.from); }
      return; }
    if (pinch) { if (pts.size < 2) pinch = null; pan = null; return; }
    if (ovDrag) { const d = ovDrag; ovDrag = null; lanesKey = "";
      if (st && e.type === "pointerup") { if (d.moved) st.ovRefresh(); else { st.ovSelect(d.i); if (sel >= 0) selectClip(-1, false); if (!wide() && tool !== "text") { tool = "text"; apply(); } } }
      return; }
    if (trim && st && e.type === "pointerup") {
      const t = trim; trim = null;
      if (t.left && Math.abs(t.to - st.edit[t.i].start) >= 0.02) { if (st.shotRoll(t.i, t.to)) { shotKey = ""; if (vn()) selectClip(t.i, false); } }
      else if (!t.left && Math.abs(t.to - st.edit[t.i].end) >= 0.02) { st.shotRipple(t.i, t.to); shotKey = ""; if (vn()) selectClip(t.i, false); }
      else if (!vn()) pan = { x: e.clientX, t0, now: st.now, moved: false, vx: 0, lt: 0, lx: e.clientX }; // pressed, not dragged: a tap
    }
    if (pan && pan.moved && vn() && st && e.type === "pointerup" && Math.abs(pan.vx) > 0.25) flick(pan.vx);
    if (pan && !pan.moved && st && e.type === "pointerup") {
      // a tap on a shot (its transition, effect or speed: that tab) opens the shot sheet over it; elsewhere: the playhead
      if (e.clientX - lanes.getBoundingClientRect().left < labW()) { laneTap(e.clientY, e.clientX - lanes.getBoundingClientRect().left); trim = null; pan = null; lanesKey = ""; return; }
      if (plusAt(e.clientX, e.clientY)) { $("addv").click(); trim = null; pan = null; return; }
      const hit = hitAt(e.clientX, e.clientY), k = hit ? hit.k : shotAt(e.clientX, e.clientY);
      if (k >= 0 && phone() && !hit) { if (sel !== k) selectClip(k, false); else openShot(k, shotTab, e.clientX); } // a phone: tap = select, again = its picker
      else if (k >= 0) { if (phone()) selectClip(k, false); openShot(k, hit ? hit.tab : shotTab, e.clientX); }
      else if (vn()) { if (sel >= 0) selectClip(-1); if (st.ovSel >= 0) st.ovSelect(-1); } // VN: a tap beside the clips lets go
      else void st.kfSeek(Math.max(0, Math.min(st.dur - 0.01, tAt(e.clientX))));
    }
    trim = null; pan = null; lanesKey = "";
  };
  lanes.addEventListener("pointerup", up, sig);
  lanes.addEventListener("pointercancel", up, sig);
  // a touchpad: a pinch arrives as a wheel with Ctrl; a sideways swipe moves along
  lanes.addEventListener("wheel", (e) => {
    const st = S(); if (!st || !st.dur) return;
    const r = lanes.getBoundingClientRect(), f = (e.clientX - r.left - labW()) / (r.width - labW());
    if (e.ctrlKey) { e.preventDefault(); const tm = tAt(e.clientX); zoom *= Math.exp(-e.deltaY * 0.012); fix(); if (!vn()) { t0 = tm - f * span(); fix(); } }
    else if (vn() && (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey)) { e.preventDefault(); scrub(st.now + (e.deltaX || e.deltaY) / pxs()); }
    else if (zoom > 1 && (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey)) { e.preventDefault(); t0 += ((e.deltaX || e.deltaY) / (r.width - labW())) * span(); fix(); }
  }, { passive: false, signal: ac.signal });

  // a tap on a track's head ("+ Add"): Effects → the shot's effects, Video → more clips, Text / Voice / Music → that tool
  const laneTap = (y: number, x = 0) => {
    const st = S(), yy = y - lanes.getBoundingClientRect().top; if (!st) return;
    const [vh, th, oh] = ROWS(), text = VTOP + vh + GAP, voice = text + th + GAP, music = voice + oh + GAP;
    // the Music head: its sound on / off (a computer: the speaker; "+ Add" there opens Music)
    if (yy >= music && (!wide() || (x > labW() - 54 && x < labW() - 34))) { muteMusic(); return; } // phones: the whole lane; computers: its speaker
    if (yy >= RUL && yy < RUL + FXH) { const k = Math.max(0, st.segAt(st.now)); openShot(k, 1, xOf((st.edit[k].start + st.edit[k].end) / 2)); }
    else if (yy >= VTOP && yy < text) $("addv").click();
    else { const t = yy < voice ? "text" : yy < music ? "voice" : "music"; const b = root.querySelector<HTMLButtonElement>(`.tool[data-tool="${t}"]`); if (b && tool !== t) b.click(); }
  };
  // the music on / off (the Music track's head): its volume to 0 and back to what it was
  function muted0() { return root.querySelector<HTMLInputElement>("#mvol")?.value === "0"; }
  function muteMusic() {
    const r = root.querySelector<HTMLInputElement>("#mvol"); if (!r) return;
    if (+r.value > 0) { r.dataset.was = r.value; r.value = "0"; } else r.value = r.dataset.was && +r.dataset.was > 0 ? r.dataset.was : "1";
    r.dispatchEvent(new Event("input", { bubbles: true })); r.dispatchEvent(new Event("change", { bubbles: true })); lanesKey = "";
  }
  // where a moved clip lands: the place under the finger (before the first, after the last at the ends)
  function dropAt(x: number) {
    const st = S(); if (!st || !st.edit.length) return 0;
    const k = st.edit.findIndex((e) => xOf(e.start) <= x && x < xOf(e.end));
    return k >= 0 ? k : x < xOf(st.edit[0].start) ? 0 : st.edit.length - 1;
  }
  // ---- phones: the selected clip and its own toolbar (as VN): Transition, Effect, Speed, Split … every clip tool ----
  const clipbar = $("clipbar"), ctpop = $("ctpop");
  // computers: ONE bar at the bottom: the tools (the dock, moved in), then the clip's tools; phones keep them apart (as designed)
  const dock = $("dock"), dockHome = dock.parentElement!, dockNext = dock.nextElementSibling;
  // …and the library's own buttons (Media, Stickers) at its very start: nothing to pick from at the top of a panel any more
  const ptabs = $("ptabs"), ptHome = ptabs.parentElement!, ptNext = ptabs.nextElementSibling;
  // …and the bar itself (with the clip tools' pop-up) is the editor's last row, right under the timeline, on a computer
  const create = root.querySelector<HTMLElement>(".create")!, cbHome = clipbar.parentElement!, cbNext = clipbar.nextElementSibling;
  const dockIn = (_on: boolean) => {
    // In modern workbench layout, toolDock remains in place and clip tools are in inspector
  };
  const clipBox = () => { let b = clipbar.querySelector<HTMLElement>(":scope > .cbin"); if (!b) { b = document.createElement("div"); b.className = "cbin lg:in-[.brs.made.v-one:not(.fopen)]:flex lg:in-[.brs.made.v-one:not(.fopen)]:items-center lg:in-[.brs.made.v-one:not(.fopen)]:flex-none lg:in-[.brs.made.v-one:not(.fopen)]:ml-1.5 lg:in-[.brs.made.v-one:not(.fopen)]:pl-2.5 lg:in-[.brs.made.v-one:not(.fopen)]:[border-left:1px_solid_var(--border)] lg:in-[.brs.made.v-one:not(.fopen)_.clipbar]:order-[2]"; clipbar.append(b); } return b; };
  let ctPopKey = "";
  const CB_SIGN: Record<string, string> = {
    tr: '<path d="M4 6l7 6-7 6zM20 6l-7 6 7 6z"/>', fx: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
    sp: '<circle cx="12" cy="13" r="8"/><path d="M12 13l4-3M9 2h6"/>', close: '<path d="M6 6l12 12M18 6L6 18"/>', reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/>',
  };
  const svg = (d: string) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ONE_TAP = new Set(["rot", "fh", "fv", "fit", "rev"]);
  function renderClipBar() {
    // a computer: always under the timeline, for the clicked clip or else the one under the playhead (the tools never change place)
    const st0 = S(), cur = sel >= 0 ? sel : wide() && st0 ? st0.segAt(st0.now) : -1;
    const st = st0, on = cur >= 0 && !!st && !!st.edit[cur] && editing && made();
    if (clipbar.hidden === on) clipbar.hidden = !on;
    root.classList.toggle("clipsel", on);
    dockIn(on && wide());
    if (!on || !st) { if (!ctpop.hidden) { ctpop.hidden = true; ctPopKey = ""; } return; }
    const e = st.edit[cur], c = st.segAt(st.now) === cur ? st.shotCs() : null;
    const isOn = (k: string) => !!c && (k === "rot" ? c.rot !== 0 : k === "fh" ? c.fh : k === "fv" ? c.fv : k === "fit" ? c.fit : k === "rev" ? c.rev : k === "vol" ? c.vol > 0 : k === "adjust" ? !!(c.bri || c.con || c.sat || c.warm) : false);
    const b = (k: string, n: string, ic: string, extra = "") => `<button type="button" class="cb max-lg:flex-[0_0_66px] max-lg:h-14.5 max-lg:grid max-lg:justify-items-center max-lg:content-center max-lg:gap-1 max-lg:border-0 max-lg:rounded-[12px] max-lg:bg-transparent max-lg:text-foreground max-lg:[font:600_10.5px_var(--body)] max-lg:cursor-pointer max-lg:py-1 max-lg:px-0.5 max-lg:[&_span]:max-w-15.5 max-lg:[&_span]:whitespace-nowrap max-lg:[&_span]:overflow-hidden max-lg:[&_span]:text-ellipsis max-lg:[&_svg]:w-[21px] max-lg:[&_svg]:h-[21px] max-lg:[&.on]:text-accent max-lg:[&.on]:bg-[color:color-mix(in_srgb,var(--accent)_14%,transparent)] max-lg:disabled:opacity-35 max-lg:[&[data-cb='delete']]:text-[#ff6a7a] lg:in-[.brs.made.v-one:not(.fopen)]:h-14.5 lg:in-[.brs.made.v-one:not(.fopen)]:grid lg:in-[.brs.made.v-one:not(.fopen)]:justify-items-center lg:in-[.brs.made.v-one:not(.fopen)]:content-center lg:in-[.brs.made.v-one:not(.fopen)]:gap-1 lg:in-[.brs.made.v-one:not(.fopen)]:border-0 lg:in-[.brs.made.v-one:not(.fopen)]:rounded-[12px] lg:in-[.brs.made.v-one:not(.fopen)]:bg-transparent lg:in-[.brs.made.v-one:not(.fopen)]:text-foreground lg:in-[.brs.made.v-one:not(.fopen)]:[font:500_11.5px_var(--body)] lg:in-[.brs.made.v-one:not(.fopen)]:cursor-pointer lg:in-[.brs.made.v-one:not(.fopen)]:py-1 lg:in-[.brs.made.v-one:not(.fopen)]:px-0.5 lg:in-[.brs.made.v-one:not(.fopen)]:hover:bg-surface-2 lg:in-[.brs.made.v-one:not(.fopen)]:[&_span]:max-w-17 lg:in-[.brs.made.v-one:not(.fopen)]:[&_span]:whitespace-nowrap lg:in-[.brs.made.v-one:not(.fopen)]:[&_span]:overflow-hidden lg:in-[.brs.made.v-one:not(.fopen)]:[&_span]:text-ellipsis lg:in-[.brs.made.v-one:not(.fopen)]:[&_svg]:w-[21px] lg:in-[.brs.made.v-one:not(.fopen)]:[&_svg]:h-[21px] lg:in-[.brs.made.v-one:not(.fopen)]:[&.on]:text-accent lg:in-[.brs.made.v-one:not(.fopen)]:[&.on]:bg-[color:color-mix(in_srgb,var(--accent)_14%,transparent)] lg:in-[.brs.made.v-one:not(.fopen)]:disabled:opacity-35 lg:in-[.brs.made.v-one:not(.fopen)]:disabled:cursor-default lg:in-[.brs.made.v-one:not(.fopen)]:[&[data-cb='delete']]:text-[#ff6a7a] lg:in-[.brs.made.v-one:not(.fopen)]:flex-[0_0_70px] lg:in-[.brs.made.v-one:not(.fopen)]:[scroll-snap-align:start] lg:in-[.brs.made.v-one:not(.fopen)_.cbin_.cbrow]:flex-[0_0_70px]${isOn(k) ? " on" : ""}" data-cb="${k}"${extra}>${ic}<span>${n}</span></button>`;
    const tools = st.kind === "talk" ? [] : CLIP_TOOLS;
    const key = [cur, sel, st.editGen, st.edit.length, JSON.stringify(c), e.tr, e.efx, e.sp?.label].join("|");
    if (clipbar.dataset.k === key) return; clipbar.dataset.k = key;
    (wide() ? clipBox() : clipbar).innerHTML = `<div class="cbhead max-lg:flex max-lg:items-center max-lg:gap-2 max-lg:py-0 max-lg:px-3 max-lg:[&_b]:[font:600_13.5px_var(--body)] max-lg:[&_small]:text-muted max-lg:[&_small]:[font:600_12px_var(--mono)] lg:in-[.brs.made.v-one:not(.fopen)]:[&_b]:[font:600_13.5px_var(--body)] lg:in-[.brs.made.v-one:not(.fopen)]:[&_small]:text-muted lg:in-[.brs.made.v-one:not(.fopen)]:[&_small]:[font:600_12px_var(--mono)] lg:in-[.brs.made.v-one:not(.fopen)]:pt-0 lg:in-[.brs.made.v-one:not(.fopen)]:pr-2.5 lg:in-[.brs.made.v-one:not(.fopen)]:pb-0 lg:in-[.brs.made.v-one:not(.fopen)]:pl-2 lg:in-[.brs.made.v-one:not(.fopen)]:[border-right:1px_solid_var(--border)] lg:in-[.brs.made.v-one:not(.fopen)]:flex-col lg:in-[.brs.made.v-one:not(.fopen)]:gap-1 lg:in-[.brs.made.v-one:not(.fopen)]:grid lg:in-[.brs.made.v-one:not(.fopen)]:grid-cols-[auto_auto] lg:in-[.brs.made.v-one:not(.fopen)]:grid-rows-[auto_auto] lg:in-[.brs.made.v-one:not(.fopen)]:gap-x-2 lg:in-[.brs.made.v-one:not(.fopen)]:gap-y-0 lg:in-[.brs.made.v-one:not(.fopen)]:items-center lg:in-[.brs.made.v-one:not(.fopen)_.cbin]:flex-none lg:in-[.brs.made.v-one:not(.fopen)_.cbin]:[border-right:0] lg:in-[.brs.made.v-one:not(.fopen)_.cbin]:pt-0 lg:in-[.brs.made.v-one:not(.fopen)_.cbin]:pr-2 lg:in-[.brs.made.v-one:not(.fopen)_.cbin]:pb-0 lg:in-[.brs.made.v-one:not(.fopen)_.cbin]:pl-0"><button type="button" class="cbx max-lg:w-7.5 max-lg:h-7.5 max-lg:rounded-[50%] max-lg:border max-lg:border-border max-lg:bg-surface-2 max-lg:text-foreground max-lg:grid max-lg:place-items-center max-lg:cursor-pointer max-lg:[&_svg]:w-[15px] max-lg:[&_svg]:h-[15px] lg:in-[.brs.made.v-one:not(.fopen)]:w-7.5 lg:in-[.brs.made.v-one:not(.fopen)]:h-7.5 lg:in-[.brs.made.v-one:not(.fopen)]:rounded-[50%] lg:in-[.brs.made.v-one:not(.fopen)]:border lg:in-[.brs.made.v-one:not(.fopen)]:border-border lg:in-[.brs.made.v-one:not(.fopen)]:bg-surface-2 lg:in-[.brs.made.v-one:not(.fopen)]:text-foreground lg:in-[.brs.made.v-one:not(.fopen)]:grid lg:in-[.brs.made.v-one:not(.fopen)]:place-items-center lg:in-[.brs.made.v-one:not(.fopen)]:cursor-pointer lg:in-[.brs.made.v-one:not(.fopen)]:[&_svg]:w-[15px] lg:in-[.brs.made.v-one:not(.fopen)]:[&_svg]:h-[15px] lg:in-[.brs.made.v-one:not(.fopen)]:row-[1/3]" data-cb="close" aria-label="Back to the tools">${svg(CB_SIGN.close)}</button><b>Shot ${cur + 1}</b><small>${(e.end - e.start).toFixed(1)} s</small></div><div class="cbrow max-lg:flex max-lg:gap-0.5 max-lg:overflow-x-auto max-lg:[overscroll-behavior-x:contain] max-lg:[scrollbar-width:none] max-lg:py-0 max-lg:px-1.5 max-lg:[&::-webkit-scrollbar]:hidden lg:in-[.brs.made.v-one:not(.fopen)]:flex lg:in-[.brs.made.v-one:not(.fopen)]:gap-0.5 lg:in-[.brs.made.v-one:not(.fopen)]:flex-nowrap lg:in-[.brs.made.v-one:not(.fopen)]:justify-start lg:in-[.brs.made.v-one:not(.fopen)]:overflow-x-auto lg:in-[.brs.made.v-one:not(.fopen)]:[overscroll-behavior-x:contain] lg:in-[.brs.made.v-one:not(.fopen)]:[scrollbar-width:thin] lg:in-[.brs.made.v-one:not(.fopen)]:[scroll-snap-type:x_proximity] lg:in-[.brs.made.v-one:not(.fopen)]:pt-0 lg:in-[.brs.made.v-one:not(.fopen)]:px-1 lg:in-[.brs.made.v-one:not(.fopen)]:pb-0.5 lg:in-[.brs.made.v-one:not(.fopen)]:[-webkit-mask-image:linear-gradient(to_right,transparent,#000_12px,#000_calc(100%_-_24px),transparent)] lg:in-[.brs.made.v-one:not(.fopen)]:[mask-image:linear-gradient(to_right,transparent,#000_12px,#000_calc(100%_-_24px),transparent)] lg:in-[.brs.made.v-one:not(.fopen)_.cbin]:flex-none lg:in-[.brs.made.v-one:not(.fopen)_.cbin]:overflow-visible lg:in-[.brs.made.v-one:not(.fopen)_.cbin]:[-webkit-mask-image:none] lg:in-[.brs.made.v-one:not(.fopen)_.cbin]:[mask-image:none] lg:in-[.brs.made.v-one:not(.fopen)_.cbin]:p-0">`
      + b("tr", "Transition", svg(CB_SIGN.tr), cur ? "" : " disabled") + b("fx", "Effect", svg(CB_SIGN.fx)) + b("sp", "Speed", svg(CB_SIGN.sp))
      + (st.kind === "talk" ? "" : b("split", "Split", sign("split")) + b("dup", "Duplicate", sign("dup")) + b("freeze", "Freeze", sign("freeze")) + b("other", "Other moment", sign("other")))
      + tools.map(([k, n, ic]) => b(k, n, ic)).join("")
      + (st.kind === "talk" ? "" : b("reset", "Reset", svg(CB_SIGN.reset)) + b("delete", "Delete", sign("delete"), st.edit.length < 2 ? " disabled" : ""))
      + `</div>`;
  }
  function selectClip(k: number, seek = true) {
    const st = S(); if (!st) return;
    if (k >= st.edit.length) k = -1;
    sel = k; lanesKey = ""; clipbar.dataset.k = "";
    if (!ctpop.hidden) { ctpop.hidden = true; ctPopKey = ""; }
    if (k >= 0) { if (tool && !wide()) { tool = ""; apply(); } if (seek && st.segAt(st.now) !== k) void st.kfSeek(st.edit[k].start + 0.05);
      const r = lanes.getBoundingClientRect(), e = st.edit[k]; if (xOf(e.start) < r.left + labW() || xOf(e.end) > r.right) { t0 = e.start - span() * 0.3; fix(); } } // in view
    renderClipBar();
  }
  // a tool on the selected clip works on that clip (the playhead goes into it first, if it was elsewhere)
  const into = async (k: number) => { const st = S(); if (st && st.edit[k] && st.segAt(st.now) !== k) await st.kfSeek(st.edit[k].start + 0.05); };
  const ctPopRender = () => { const st = S(), c = st?.shotCs(); if (!c || !ctPopKey) return; $("ctpopb").innerHTML = clipToolsHtml(c, ctPopKey); };
  // computers: the mouse wheel moves the clip's tools sideways (one row, as on the phone)
  clipbar.addEventListener("wheel", (ev) => { const row = wide() ? clipbar : clipbar.querySelector<HTMLElement>(".cbrow"); if (row && Math.abs(ev.deltaY) > Math.abs(ev.deltaX)) { row.scrollLeft += ev.deltaY; ev.preventDefault(); } }, { passive: false, signal: sig.signal });
  clipbar.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-cb]"); if (!btn || btn.disabled) return;
    if (btn.dataset.cb === "close") { selectClip(-1); return; }
    void clipTool(btn.dataset.cb!, wide());
  }, sig);
  // a clip tool (the phone's clip bar or the inspector's grid) on the selected clip, or else the one under the playhead
  async function clipTool(k: string, orCurrent: boolean) {
    const st = S(); if (!st) return;
    if (sel < 0 && orCurrent) selectClip(st.segAt(st.now), false);
    if (sel < 0) return;
    await into(sel);
    if (k === "tr" || k === "fx" || k === "sp") { openShot(sel, { tr: 0, fx: 1, sp: 2 }[k], xOf((st.edit[sel].start + st.edit[sel].end) / 2)); return; }
    if (k === "split" || k === "dup" || k === "freeze" || k === "delete") { if (st.shotOp(k)) { shotKey = ""; selectClip(Math.max(0, st.segAt(st.now)), false); } return; }
    if (k === "other") { other(); clipbar.dataset.k = ""; renderClipBar(); return; }
    if (k === "reset") { st.shotSet(null); clipbar.dataset.k = ""; renderClipBar(); return; }
    const c = st.shotCs(); if (!c) return;
    if (ONE_TAP.has(k)) {
      if (k === "rev") await st.shotReverse(); else st.shotSet(k === "rot" ? { rot: (c.rot + 90) % 360 } : { [k]: !c[k as "fh"] });
      clipbar.dataset.k = ""; renderClipBar(); return;
    }
    // every other tool: its own controls, alone, over the timeline
    const name = CLIP_TOOLS.find((x) => x[0] === k)?.[1] ?? "", shot = "Shot " + String(sel + 1).padStart(2, "0");
    ctPopKey = k; $("ctpoph").textContent = name; $("ctpopic").innerHTML = Glyph(name, 18); setText($("ctpopsub"), shot.toUpperCase()); setText($("ctpopfoot"), "Preview selection · " + shot);
    ctPopRender(); if (ctpop.hidden) ctSnap = st.snap(); ctpop.hidden = false;
  }
  // the inspector's Clip Controls: the same tools as the clip bar, on the selected clip
  const stGrid = $("shottoolgrid");
  stGrid?.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-st]"), st = S();
    if (!btn || btn.disabled || !st || !made() || !st.edit.length) return;
    const k = btn.dataset.st!, cur = sel >= 0 ? sel : Math.max(0, st.segAt(st.now));
    stGrid.querySelectorAll(".shotToolActive").forEach((b) => b.classList.remove("shotToolActive"));
    btn.classList.add("shotToolActive");
    setText($("inspect-tool-text"), `${btn.dataset.stname || k} selected for Shot ${String(cur + 1).padStart(2, "0")}`);
    void clipTool(k, true);
  }, sig);
  // what the grid can do for this clip: no transition into the first shot, no delete of the only one, a talk has no shot edits
  let gridKey = "";
  function paintGrid() {
    const st = S(); if (!stGrid || !st || !made()) return;
    const cur = sel >= 0 ? sel : Math.max(0, st.segAt(st.now)), talk = st.kind === "talk", c = st.segAt(st.now) === cur ? st.shotCs() : null;
    const key = [cur, st.edit.length, talk, JSON.stringify(c)].join("|"); if (key === gridKey) return; gridKey = key;
    const OFF_TALK = new Set(["split", "dup", "freeze", "other", "reset", "delete", ...CLIP_TOOLS.map((x) => x[0])]);
    stGrid.querySelectorAll<HTMLButtonElement>("[data-st]").forEach((b) => {
      const k = b.dataset.st!;
      b.disabled = (k === "tr" && cur === 0) || (k === "delete" && st.edit.length < 2) || (talk && OFF_TALK.has(k));
      b.classList.toggle("on", !!c && (k === "rot" ? c.rot !== 0 : k === "fh" ? c.fh : k === "fv" ? c.fv : k === "fit" ? c.fit : k === "rev" ? c.rev : false));
    });
  }
  clipToolsEvents(ctpop, () => S(), () => ctPopKey, (k) => { if (k) ctPopKey = k; }, () => { ctPopRender(); clipbar.dataset.k = ""; renderClipBar(); }, sig);
  // computers: ✓ keeps what was tried in the pop-up, ✕ puts the clip back as it was when it opened
  let ctSnap: unknown = null;
  $("ctpopok").addEventListener("click", () => { ctpop.hidden = true; ctPopKey = ""; ctSnap = null; }, sig);
  $("ctpopx").addEventListener("click", () => { const st = S(); if (st && ctSnap) st.unsnap(ctSnap); ctSnap = null; ctpop.hidden = true; ctPopKey = ""; clipbar.dataset.k = ""; renderClipBar(); }, sig);
  document.addEventListener("pointerdown", (e) => {
    const t = e.target as Node;
    if (!ctpop.hidden && !ctpop.contains(t) && !stGrid?.contains(t)) {
      ctpop.hidden = true; ctPopKey = ""; ctSnap = null;
    }
    const pnl = $("panels");
    if (tool && pnl && !pnl.hidden && !pnl.contains(t) && !$("dock")?.contains(t)) {
      tool = ""; apply();
    }
  }, { capture: true, ...sig });
  // the shot sheet (like CapCut / VN): over the clip on a computer (an arrow points at it), from the bottom on a phone;
  // its chips show every choice with the shot's own one selected; ✕, Escape or a tap outside closes it
  const sheet = $("shotsheet");
  let sheetX = 0;
  const shotAt = (x: number, y: number) => { const st = S(), r = lanes.getBoundingClientRect(), yy = y - r.top; if (!st || yy < VTOP || yy > VTOP + vidH()) return -1; return st.edit.findIndex((e) => xOf(e.start) <= x && x < xOf(e.end)); };
  // moved or resized by the person (drag its head, its corner or an edge): it stays where they put it, this visit and the
  // next (a double-click on its head puts it back over the clip)
  const FREE_KEY = "studio-shotsheet";
  let free: { x: number; y: number; w: number; h: number } | null = null;
  try { const j = JSON.parse(localStorage.getItem(FREE_KEY) || "null"); if (j && [j.x, j.y, j.w, j.h].every((v) => typeof v === "number")) free = j; } catch { /* private mode */ }
  const keepFree = () => { try { if (free) localStorage.setItem(FREE_KEY, JSON.stringify(free)); else localStorage.removeItem(FREE_KEY); } catch { /* private mode */ } };
  const placeFree = () => {
    const f = free!, W = window.innerWidth, H = window.innerHeight;
    f.w = Math.max(300, Math.min(W - 16, f.w)); f.h = Math.max(220, Math.min(H - 16, f.h));
    f.x = Math.max(8, Math.min(W - f.w - 8, f.x)); f.y = Math.max(8, Math.min(H - f.h - 8, f.y));
    Object.assign(sheet.style, { left: f.x + "px", top: f.y + "px", width: f.w + "px", height: f.h + "px", right: "auto", bottom: "auto", maxHeight: "none" });
    sheet.classList.add("free");
  };
  const placeSheet = () => {
    if (sheet.hidden) return;
    if (free) { placeFree(); return; }
    sheet.classList.remove("free"); sheet.style.top = sheet.style.height = sheet.style.right = "";
    if (!wide()) { sheet.classList.remove("docked"); for (const k of ["left", "bottom", "width", "maxHeight"] as const) sheet.style[k] = ""; return; } // a phone: the CSS sheet
    // a computer: at the bottom, as on the phone: right above the bar there (the clip's toolbar or the tools), the same width
    sheet.classList.remove("docked"); sheet.classList.add("atbottom");
    const cb = $("clipbar"), dk = root.querySelector<HTMLElement>(".dock"), bar = !cb.hidden ? cb : dk && dk.offsetParent ? dk : null;
    const br = bar ? bar.getBoundingClientRect() : null, w = br ? br.width : Math.min(980, window.innerWidth - 300);
    sheet.style.width = w + "px"; sheet.style.left = (br ? br.left : (window.innerWidth - w) / 2) + "px";
    sheet.style.bottom = (br ? window.innerHeight - br.top + 8 : 12) + "px";
    sheet.style.maxHeight = Math.max(220, Math.min(window.innerHeight * 0.46, (br ? br.top : window.innerHeight) - 90)) + "px";
  };
  let sheetSnap: unknown = null;
  const openShot = (k: number, tab: number, x: number) => {
    const st = S(); if (!st || !st.edit[k]) return;
    void st.kfSeek(st.edit[k].start + 0.05);
    shotTab = tab; shotKey = ""; sheetX = xOf((st.edit[k].start + st.edit[k].end) / 2) || x;
    if (sheet.hidden) sheetSnap = st.snap(); // what ✕ puts back
    sheet.hidden = false; root.classList.add("sheeton"); placeSheet();
  };
  const closeShot = () => { if (sheet.hidden) return; sheet.hidden = true; root.classList.remove("sheeton"); markTabs(); };
  // the left panel's tabs while the shot's Transition / Effect is open there
  function markTabs() {
    const on = !sheet.hidden && sheet.classList.contains("docked") ? (shotTab === 1 ? "effects" : shotTab === 0 ? "transitions" : "") : "";
    if (on) root.querySelectorAll<HTMLButtonElement>("#ptabs [data-pt]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.pt === on)));
  }
  // dragging: its head moves it; its corner or an edge resizes it (a mouse, a finger or a pen)
  let drag: { mode: string; px: number; py: number; f: { x: number; y: number; w: number; h: number } } | null = null;
  const EDGE_PX = 8;
  const edgeOf = (e: PointerEvent) => {
    const r = sheet.getBoundingClientRect(), t = e.target as HTMLElement;
    if (sheet.classList.contains("docked")) return "";
    if (t.closest(".ss-rs")) return "se";
    const l = e.clientX - r.left < EDGE_PX, rt = r.right - e.clientX < EDGE_PX, b = r.bottom - e.clientY < EDGE_PX, tp = e.clientY - r.top < EDGE_PX;
    const m = (tp ? "n" : b ? "s" : "") + (l ? "w" : rt ? "e" : "");
    if (m) return m;
    if (t.closest(".ssh, .ss-head") && !t.closest("button, select, input, a")) return "move";
    return "";
  };
  sheet.addEventListener("pointermove", (e) => {
    if (drag) return;
    const m = edgeOf(e), c = m === "move" ? "move" : m ? m + "-resize" : "";
    if (sheet.style.cursor !== c) sheet.style.cursor = c;
  }, sig);
  sheet.addEventListener("pointerdown", (e) => {
    const mode = edgeOf(e); if (!mode) return;
    e.preventDefault();
    const r = sheet.getBoundingClientRect();
    if (!free) free = { x: r.left, y: r.top, w: r.width, h: r.height };
    drag = { mode, px: e.clientX, py: e.clientY, f: { ...free } };
    try { sheet.setPointerCapture(e.pointerId); } catch { /* gone */ }
    sheet.classList.add("dragging");
  }, sig);
  sheet.addEventListener("pointermove", (e) => {
    if (!drag || !free) return;
    const dx = e.clientX - drag.px, dy = e.clientY - drag.py, o = drag.f, m = drag.mode;
    if (m === "move") { free.x = o.x + dx; free.y = o.y + dy; }
    else {
      if (m.includes("e")) free.w = o.w + dx;
      if (m.includes("s")) free.h = o.h + dy;
      if (m.includes("w")) { free.w = o.w - dx; free.x = o.x + Math.min(dx, o.w - 300); }
      if (m.includes("n")) { free.h = o.h - dy; free.y = o.y + Math.min(dy, o.h - 220); }
    }
    placeFree();
  }, sig);
  const dragEnd = () => { if (!drag) return; drag = null; sheet.classList.remove("dragging"); keepFree(); };
  sheet.addEventListener("pointerup", dragEnd, sig);
  sheet.addEventListener("pointercancel", dragEnd, sig);
  sheet.addEventListener("dblclick", (e) => { const t = e.target as HTMLElement; if (!t.closest(".ssh, .ss-head") || t.closest("button, select, input")) return; free = null; keepFree(); placeSheet(); }, sig);
  // computers: ✕ puts the shot back as it was when the picker opened, ✓ keeps the choice (phones: ✕ closes, as before)
  $("ssx").addEventListener("click", () => { const st = S(); if (wide() && st && sheetSnap) st.unsnap(sheetSnap); sheetSnap = null; closeShot(); }, sig);
  $("ssok").addEventListener("click", () => { sheetSnap = null; closeShot(); }, sig);
  // the custom speed: the number while dragging, the shot's speed when let go (a constant speed curve, the engine's own)
  $("ssbody").addEventListener("input", (e) => { const t = e.target as HTMLInputElement; if (t.id === "ssspd") { const o = $("ssspdv"); o.textContent = spdTxt(spdOf(+t.value)); } }, sig);
  $("ssbody").addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement, st = S(); if (t.id !== "ssspd" || !st) return;
    const v = spdOf(+t.value); st.shotSet({ curve: { a: v, b: v, c: v, d: v, e: v } }); shotKey = "";
  }, sig);
  // ‹ › : the shot before / after, in the same sheet
  $("ssbody").addEventListener("click", (e) => { const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-snav]"); const st = S(); if (!b || !st) return;
    const k = Math.max(0, Math.min(st.edit.length - 1, st.segAt(st.now) + +b.dataset.snav!)); openShot(k, shotTab, xOf((st.edit[k].start + st.edit[k].end) / 2)); }, sig);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeShot(); }, sig);
  document.addEventListener("pointerdown", (e) => { const t = e.target as Node; if (!sheet.hidden && !sheet.contains(t) && !lanes.contains(t)) closeShot(); }, { capture: true, ...sig });
  window.addEventListener("scroll", placeSheet, { passive: true, ...sig });
  window.addEventListener("resize", placeSheet, sig);

  // the times, the shot, the lanes: kept up to date while the page is open (each redraws only on a change)
  let raf = 0;
  const tick = () => {
    const st = S();
    if (st && made()) {
      setText($("tcur"), fmt2(st.now)); setText($("ttot"), fmt2(st.dur));
      const prg = $("prog"); if (prg && st.dur > 0) prg.style.width = Math.min(100, Math.max(0, (st.now / st.dur) * 100)).toFixed(2) + "%";
      if (root.classList.contains("playing") !== st.playing) { root.classList.toggle("playing", st.playing); $("playov").setAttribute("aria-label", st.playing ? "Pause preview" : "Play preview"); }
      shotUI(); clipUI(); drawLanes(); paintGrid();
      if (sel >= 0 && (sel >= st.edit.length || !editing)) selectClip(-1, false); else if (sel >= 0 || wide() || dock.parentElement === clipbar || clipbar.parentElement === create) renderClipBar(); // (a narrowed window: the bars go back to the phone's places)
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  // fold the song and clips once the Reel is made (tap the line to open them again)
  let wasMade = made();
  const onChange = () => {
    if (root.classList.contains("review") !== reviewNow()) root.classList.toggle("review", reviewNow());
    paintLocks(); // the administrator's class comes after the first paint
    const af = String(asFree()), ab = root.querySelector("#tbasfree"); if (ab && ab.getAttribute("aria-pressed") !== af) ab.setAttribute("aria-pressed", af);
    // the editor's workspace (.noir: its layout); its colours follow the app's Light / Dark switch (app/globals.css)
    const noir = made() && !root.classList.contains("fopen");
    if (root.classList.contains("noir") !== noir) { root.classList.toggle("noir", noir); media(noir); }
    mirror(); values();
    const m = made();
    if (m !== wasMade) {
      wasMade = m;
      openStep("s1", !m); openStep("s2", !m);
      const tpl = root.querySelector(".tplrow")!;
      if (m) root.querySelector('.panel[data-panel="style"]')!.append(tpl); else root.querySelector("#s0 .makegrid")!.after(tpl);
      if (m && !tool) tool = defTool();
      apply();
    }
  };
  const mo = new MutationObserver(onChange);
  mo.observe(root, { subtree: true, attributes: true, attributeFilter: ["aria-pressed", "disabled", "class", "hidden"], childList: true, characterData: true });
  root.addEventListener("input", values, sig);

  tool = defTool();
  if (q && root.querySelector(`.panel[data-panel="${q}"]`)) tool = q; // a link can open a tool: /create/edit?tool=text
  apply(); onChange(); onView(view);
  // the engine read the plan and the plan locks from the server (components/studio/engine.ts planLoad)
  root.addEventListener("brs-plan", (e) => {
    const d = (e as CustomEvent<{ plan: string; open: boolean; need: Record<string, string> }>).detail;
    plan = d.plan || "free"; open = d.open; need = d.need || need;
    if (tool && locked(tool)) tool = defTool(); // a plan that no longer opens the tool shown
    apply();
  }, sig);
  return { cleanup: () => { ac.abort(); mo.disconnect(); cancelAnimationFrame(raf); } };
}
