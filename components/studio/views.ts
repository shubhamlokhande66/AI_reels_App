/** Fast Studio's editor, one view for everyone (like CapCut or VN), on the markup of components/studio/markup.ts (the
 * editing itself is the engine's; everything here shows, hides or forwards to the engine's own controls):
 * - every tool in one bar (Shot, Music, Text, Captions, Look, Motion, Background, Overlay, Voice, Style), one panel open
 *   at a time; computers: the tools down the left, the preview in the middle, the open tool on the right and the
 *   multi-track timeline (video, text, voice, music) underneath; phones: the tools in a row under the preview.
 * - Pro tools (PRO_TOOLS) carry a PRO tag: on a free plan a tap opens the pricing page instead.
 * Also: the song and clips steps fold into one line once the Reel is made, the top bar's title and Export. */

export type StudioView = "one" | "all"; // "all": every panel open (checks and support, by link only)
// the tools of paid plans (and the administrator); free plans see them with a PRO tag that opens /pricing
export const PRO_TOOLS = new Set(["motion", "layers", "bg", "voice"]);

type Shot = { start: number; end: number; src: number; type: string; tr: string; efx: string; uk?: { t: number }[]; ak?: { t: number }[]; acc?: { at: number; do: string }[]; sp?: { label: string } };
type Ov = { t0: number; t1: number; all?: boolean; text: string; emoji?: boolean };
type Studio = {
  now: number; playing: boolean; dur: number; audio: AudioBuffer | null; beats: number[]; songName: string; title: string; hook: string; capsOn: boolean;
  edit: Shot[]; overlays: Ov[]; vo: unknown; kind: string; editGen: number;
  sources: { name: string }[]; shotCs: ClipApi["shotCs"]; shotSet: ClipApi["shotSet"]; shotSlip: ClipApi["shotSlip"]; shotTrim: ClipApi["shotTrim"]; shotExtract: ClipApi["shotExtract"]; shotReverse: ClipApi["shotReverse"]; shotOp: (op: "split" | "dup" | "delete" | "replace" | "freeze", arg?: number) => boolean; shotRipple: (i: number, to: number) => boolean;
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
const CLIP_COL = ["#6b5540", "#46596a", "#5a4766", "#476452", "#6e4a44", "#5f5a3c", "#3f5d63", "#6a5a2e"]; // as the engine's strip
const TYPE: Record<string, string> = { drop: "Drop", hit: "Hit", cut: "Cut", break: "Break", talk: "Talk", jump: "Talk" };
import { clipToolsEvents, clipToolsHtml, type ClipApi } from "./clipTools";

const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function initViews(root: HTMLElement, onView: (v: StudioView) => void) {
  const ac = new AbortController(), sig = { signal: ac.signal };
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>("#" + id)!;
  const S = () => (root as unknown as { __studio?: Studio }).__studio;
  const kf = $<HTMLDetailsElement>("kfbox");
  const view: StudioView = savedView();
  let tool = "";
  let shotKey = "", lanesKey = "", shotTab = 0, ctOpen = "", ctKey = "";
  const q = new URLSearchParams(location.search).get("tool");

  const made = () => !$("s3").classList.contains("locked");
  // computers keep a tool open beside the preview (the shot first); phones show the Reel, a tool opens over it
  const wide = () => window.matchMedia("(min-width: 1024px)").matches;
  const defTool = () => (wide() ? "shots" : "");
  // a paid plan (or the administrator, or billing off) uses the Pro tools; until the server says so they are locked
  let paid = false;
  const locked = (k: string) => PRO_TOOLS.has(k) && !paid && !root.classList.contains("admin");
  const apply = () => {
    root.classList.remove("v-simple", "v-editor", "v-pro", "v-one", "v-all");
    root.classList.add("v-" + view);
    root.dataset.tool = tool;
    root.classList.toggle("made", made());
    root.querySelectorAll<HTMLButtonElement>(".tool").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.tool === tool));
      const lock = String(locked(b.dataset.tool!));
      if (b.dataset.locked !== lock) b.dataset.locked = lock;
    });
    const on = new Set(view === "all" ? [...root.querySelectorAll<HTMLElement>(".panel")].map((p) => p.dataset.panel!) : tool ? [tool] : []);
    root.querySelectorAll<HTMLElement>(".panel").forEach((p) => p.classList.toggle("on", on.has(p.dataset.panel!)));
    // the keyframe panel is open when Motion is shown (dragging the picture then moves the shot)
    const kfWant = on.has("motion");
    if (kf.open !== kfWant) kf.open = kfWant;
    if (view === "all") $<HTMLDetailsElement>("allshots").open = true;
    shotKey = ""; lanesKey = "";
    requestAnimationFrame(() => { const st = S() as (Studio & { drawTimeline?: () => void }) | undefined; if (st && st.edit.length) st.drawTimeline?.(); });   // the strip at its new size
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
    const b = t.closest<HTMLButtonElement>(".tool");
    if (b) {
      const k = b.dataset.tool!;
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- plain DOM code, the pricing page is a full load
      if (locked(k)) { location.assign("/pricing?feature=" + encodeURIComponent(k)); return; } // a Pro tool on a free plan
      tool = tool === k && !wide() ? "" : k; // phones: a second tap closes it again (computers always show one)
      apply();
      return;
    }
    const sh = t.closest<HTMLButtonElement>(".step > .sh");
    if (sh) { const s = sh.parentElement!; openStep(s.id, s.classList.contains("folded")); }
  }, sig);

  // play over the preview, previous / next shot
  $("playov").addEventListener("click", () => $("play").click(), sig);
  const jump = (d: number) => { const st = S(); if (!st || !st.edit.length) return; const i = Math.max(0, Math.min(st.edit.length - 1, st.segAt(st.now) + d)); void st.kfSeek(st.edit[i].start + 0.05); };
  $("pshot").addEventListener("click", () => jump(-1), sig);
  $("nshot").addEventListener("click", () => jump(1), sig);

  // the top bar's Export is the same button as the save bar's
  const exp = $<HTMLButtonElement>("export"), top = $<HTMLButtonElement>("topexport");
  top.addEventListener("click", () => exp.click(), sig);
  const mirror = () => { if (top.disabled !== exp.disabled) top.disabled = exp.disabled; }; // only on a change: a write is a mutation too

  // the title and the summary show what is made now
  const setText = (el: Element | null, v: string) => { if (el && el.textContent !== v) el.textContent = v; };
  const values = () => {
    const st = S();
    if (st && made()) {
      setText($("tbname"), st.title || "Your Reel");
      const talk = st.kind === "talk";
      const info = fmtS(st.dur) + " · " + st.edit.length + (talk ? " parts, pauses cut" : " shots") + (st.songName && !talk ? " on the beat of " : "");
      const si = $("suminfo");
      if (si.dataset.k !== info + st.songName) { si.dataset.k = info + st.songName; si.textContent = info; if (st.songName && !talk) { const b = document.createElement("b"); b.textContent = st.songName; si.append(b); } }
      const sec = st.section, part = sec && sec.whole && sec.len < sec.whole - 0.5 ? " · " + fmtS(sec.start) + "–" + fmtS(sec.start + sec.len) : "";
      setText($("tlmusic"), st.songName ? "♪ " + st.songName + part + " · beats marked" : talk ? "The voice of your clips" : "");
    } else setText($("tbname"), "Your Reel");
  };

  // the current shot: chips (the Shot tool) and the inspector, both forwarding to the edit list's own controls
  const rowOf = (i: number) => root.querySelectorAll<HTMLTableRowElement>("#edl tr")[i];
  const shotUI = () => {
    const st = S(); if (!st || !made() || !st.edit.length) return;
    const i = st.segAt(st.now), e = st.edit[i], row = rowOf(i); if (!e || !row) return;
    const sels = [3, 4, 5].map((c) => row.children[c]?.querySelector("select") as HTMLSelectElement | null);
    const key = view + "|" + shotTab + "|" + i + "|" + st.editGen + "|" + sels.map((s) => s && s.value).join() + "|" + (e.uk ? e.uk.length : 0) + "|" + root.querySelectorAll("#edl tr").length;
    if (key === shotKey) return; shotKey = key;
    const names = ["Transition", "Effect", "Speed"];
    // as in the design: "Shot 1 · Transition" with its choices as chips (Effect and Speed one tap away)
    const head = `<div class="shh"><span class="shtabs"><b>Shot ${i + 1} ·</b>${names.map((n, k) => `<button type="button" class="shtab" data-tab="${k}" aria-pressed="${k === shotTab}">${n}</button>`).join("")}</span><span>${(e.end - e.start).toFixed(2)} s · ${esc(TYPE[e.type] || e.type)}</span></div>`;
    const s0 = sels[shotTab];
    const chips = !s0 ? "" : `<div class="chips">${[...s0.options].map((o) => `<button type="button" class="chip" data-c="${shotTab}" data-v="${esc(o.value)}" aria-pressed="${o.value === s0.value}">${esc(o.text)}</button>`).join("")}</div>`;
    const selects = sels.map((s, k) => !s ? "" : `<label class="isel"><span>${names[k]}</span><select data-c="${k}">${[...s.options].map((o) => `<option value="${esc(o.value)}"${o.value === s.value ? " selected" : ""}>${esc(o.text)}</option>`).join("")}</select></label>`).join("");
    const other = `<button type="button" class="btn ghost" data-other="1"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/></svg><span>Use a different moment</span></button>`;
    // split, duplicate, delete, replace (the music's timing stays; see the engine's shotOp)
    const clipName = (n: string) => esc(n.replace(/\.[^.]+$/, ""));
    const tools = st.kind === "talk" ? "" : `<div class="shtools" role="group" aria-label="Shot tools">`
      + `<button type="button" class="btn ghost" data-op="split" title="Split this shot where the playhead is">Split</button>`
      + `<button type="button" class="btn ghost" data-op="dup" title="Play this moment twice">Duplicate</button>`
      + `<button type="button" class="btn ghost" data-op="freeze" title="Freeze the picture at the playhead, then play on">Freeze</button>`
      + `<button type="button" class="btn ghost" data-op="delete" title="Delete this shot; the shot before takes its time"${st.edit.length < 2 ? " disabled" : ""}>Delete</button>`
      + (st.sources.length > 1 ? `<select data-rep="1" aria-label="Replace with a moment from"><option value="">Replace with…</option>${st.sources.map((s, k) => `<option value="${k}">${clipName(s.name)}${k === e.src ? " (this clip)" : ""}</option>`).join("")}</select>` : "")
      + `</div><div class="cliptools"></div>`;
    $("shotcard").innerHTML = head + chips + other + tools;
    $("inspector").innerHTML = `<div class="ihead">Shot ${i + 1} · Inspector</div>` + selects + other + tools;
    clipUI(true);
  };
  // the clip tools (rotate, fit, adjust, mosaic…): drawn again when the shot's settings change, never during a slider drag
  const clipUI = (force = false) => {
    const st = S(), boxes = root.querySelectorAll<HTMLElement>("#shotcard .cliptools, #inspector .cliptools"); if (!st || !boxes.length) return;
    if (!force && root.querySelector(".cliptools input[type=range]:focus")) return;
    const c = st.shotCs(); if (!c) return;
    const key = JSON.stringify(c) + ctOpen; if (!force && key === ctKey) return; ctKey = key;
    boxes.forEach((b) => { b.innerHTML = clipToolsHtml(c, ctOpen); });
  };
  const forward = (c: number, v: string) => { const st = S(); if (!st) return; const s = rowOf(st.segAt(st.now))?.children[c + 3]?.querySelector("select") as HTMLSelectElement | null; if (s && s.value !== v) { s.value = v; s.dispatchEvent(new Event("change")); } };
  const other = () => { const st = S(); if (!st) return; rowOf(st.segAt(st.now))?.children[2]?.querySelector<HTMLButtonElement>("button")?.click(); };
  for (const id of ["shotcard", "inspector"]) {
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
  let trim: { i: number; to: number } | null = null; // a shot's end being dragged
  const labW = () => (lanes.clientWidth > 700 ? 64 : 46);
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
  const fix = () => {
    const D = S()?.dur || 1; zoom = Math.max(1, Math.min(ZMAX, zoom)); t0 = Math.max(0, Math.min(D - D / zoom, t0)); lanesKey = "";
    setText($("tlz"), (zoom < 10 ? Math.round(zoom * 10) / 10 : Math.round(zoom)) + "×");
  };
  // − / + : half or twice the zoom, around the playhead
  const zoomBy = (f: number) => { const st = S(); if (!st) return; const at = Math.min(Math.max(st.now, t0), t0 + span()), p = (at - t0) / span(); zoom *= f; fix(); t0 = at - p * span(); fix(); };
  $("tlzi").addEventListener("click", () => zoomBy(2), sig);
  $("tlzo").addEventListener("click", () => zoomBy(0.5), sig);
  const tAt = (x: number) => { const r = lanes.getBoundingClientRect(), lab = labW(); return t0 + ((x - r.left - lab) / (r.width - lab)) * span(); };
  const xOf = (t: number) => { const r = lanes.getBoundingClientRect(), lab = labW(); return r.left + lab + ((t - t0) / span()) * (r.width - lab); };
  // the shot whose right edge is under x on the video track (not the last: it ends with the song)
  // the tracks from the top (css px): the ruler, Effects, Video, Text, Voice, Music
  const FXH = 22, GAP = 5, VTOP = RUL + FXH + GAP;
  const vidH = () => (lanes.clientWidth > 700 ? 46 : 38);
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
    st.edit.forEach((e, k) => { const d = Math.abs(xOf(e.end) - x); if (k < st.edit.length - 1 && d < bd) { bd = d; best = k; } });
    return best;
  };
  const drawLanes = () => {
    const st = S(); if (!st || !made() || !st.edit.length || !lanes.clientWidth) return;
    const D = st.dur || 1, now = st.now;
    if (st.playing && (now < t0 || now > t0 + span())) { t0 = now - span() * 0.1; fix(); } // follow the playhead
    const key = [lanes.clientWidth, zoom, t0, st.audio ? st.audio.length : 0, st.beats.length, trim ? trim.i + ":" + trim.to : "", st.editGen, st.edit.length, (now * 20) | 0, st.overlays.map((o) => o.t0 + "/" + o.t1 + o.text).join(), !!st.vo, st.hook, st.capsOn, st.edit.reduce((a, e) => a + (e.uk ? e.uk.length : 0), 0), root.querySelectorAll("#edl tr").length].join("|");
    if (key === lanesKey) return; lanesKey = key;
    const dpr = window.devicePixelRatio || 1, wide = lanes.clientWidth > 700, lab = labW() * dpr;
    const rows = [wide ? 46 : 38, 24, 24, wide ? 44 : 38].map((h) => h * dpr), gap = 5 * dpr, rul = RUL * dpr;
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
    track(() => { g.fillStyle = muted; for (let t = Math.floor(t0 / step) * step; t <= t0 + D / zoom + step; t += step) { g.fillRect(X(t), rul - 5 * dpr, dpr, 5 * dpr); g.fillText(step < 1 ? fmt(t) : fmtS(t), X(t) + 3 * dpr, rul / 2 - dpr); } });
    let y = rul;
    const label = (s: string, h: number) => { g.fillStyle = muted; g.fillText(s, 2 * dpr, y + h / 2); };
    const rr = (x: number, yy: number, w: number, h: number, r: number) => { g.beginPath(); if (g.roundRect) g.roundRect(x, yy, Math.max(1, w), h, r); else g.rect(x, yy, Math.max(1, w), h); };
    const cur = st.segAt(now), dt = trim ? trim.to - st.edit[trim.i].end : 0;
    // where each shot is drawn: while an end is dragged that shot stretches and the shots after it move with it
    const at = (k: number) => { const e = st.edit[k], sh = trim && k > trim.i ? dt : 0; return [e.start + sh, trim && k === trim.i ? trim.to : e.end + sh]; };
    // a small box with a word in it (an effect, a speed), as the pro editors show them on their tracks
    const tag = (x: number, yy: number, maxW: number, h: number, text: string, bg: string, fg = "#fff") => {
      g.font = `600 ${10.5 * dpr}px system-ui, sans-serif`;
      const w = Math.min(maxW, g.measureText(text).width + 12 * dpr); if (w < 14 * dpr) return;
      g.fillStyle = bg; rr(x, yy, w, h, 4 * dpr); g.fill();
      g.save(); g.beginPath(); g.rect(x, yy, w, h); g.clip(); g.fillStyle = fg; g.fillText(text, x + 6 * dpr, yy + h / 2 + 0.5 * dpr); g.restore();
      g.font = `${11 * dpr}px system-ui, sans-serif`;
    };
    const diamond = (x: number, yy: number, r: number, col: string) => { g.beginPath(); g.moveTo(x, yy - r); g.lineTo(x + r, yy); g.lineTo(x, yy + r); g.lineTo(x - r, yy); g.closePath(); g.fillStyle = col; g.fill(); g.lineWidth = dpr; g.strokeStyle = "rgba(0,0,0,.45)"; g.stroke(); };
    // Effects: each shot's effect (or Shubix's camera move) as a box across its shot
    label("Effects", fxh);
    track(() => st.edit.forEach((e, k) => {
      const [a, b] = at(k), x0 = X(a) + 2 * dpr, w = X(b) - X(a) - 4 * dpr;
      if (e.efx && e.efx !== "none") tag(x0, y + 2 * dpr, w, fxh - 4 * dpr, "✦ " + nameOf("efx", e.efx), "#6d4bd8");
      else if (e.ak && e.ak.length) tag(x0, y + 2 * dpr, w, fxh - 4 * dpr, "◆ Camera move", "#3c5fa8");
    }));
    y += fxh + gap;
    label("Video", rows[0]);
    track(() => st.edit.forEach((e, k) => {
      const [a, b] = at(k), x0 = X(a) + dpr, x1 = X(b) - dpr, h = rows[0];
      g.fillStyle = CLIP_COL[e.src % CLIP_COL.length]; rr(x0, y, x1 - x0, h, 5 * dpr); g.fill();
      if (k === cur || (trim && k === trim.i)) { g.lineWidth = 2 * dpr; g.strokeStyle = acc; g.stroke(); }
      if (x1 - Math.max(x0, lab) > 24 * dpr) { g.save(); rr(x0, y, x1 - x0, h, 5 * dpr); g.clip(); g.fillStyle = "rgba(255,255,255,.85)"; g.fillText(String(k + 1), Math.max(x0, lab) + 6 * dpr, y + 10 * dpr); g.restore(); }
      // speed: a small box at the bottom left
      if (e.sp && e.sp.label && e.sp.label !== "1×") tag(Math.max(x0, lab) + 4 * dpr, y + h - 16 * dpr, x1 - Math.max(x0, lab) - 8 * dpr, 13 * dpr, "⏱ " + e.sp.label, "rgba(0,0,0,.55)");
      // keyframes: yours (light blue), Shubix's camera moves (violet), the hits on the beat (gold)
      const ky = y + h - 8 * dpr, r = 4 * dpr;
      for (const q of e.ak || []) diamond(X(a + q.t), ky, r, "#a996ff");
      for (const q of e.acc || []) diamond(X(a + q.at), y + 9 * dpr, r, "#f2bb1d");
      for (const q of e.uk || []) diamond(X(a + q.t), ky, r, "#6FA8FF");
      // the handle on the right edge (the last shot ends with the song)
      if (k < st.edit.length - 1 && (k === cur || (trim && k === trim.i))) { g.fillStyle = "#fff"; rr(x1 - 5 * dpr, y + h * 0.52, 4 * dpr, h * 0.4, 2 * dpr); g.fill(); }
    }));
    // transitions: a small box on the cut (a bow tie: one shot into the next), named on hover
    track(() => st.edit.forEach((e, k) => {
      if (!k || !e.tr || e.tr === "hard") return;
      const cx = X(at(k)[0]), s = 16 * dpr, top = y + 3 * dpr; // the upper half: the trim handle is in the lower one
      g.fillStyle = "#fff"; rr(cx - s / 2, top, s, s, 4 * dpr); g.fill(); g.lineWidth = dpr; g.strokeStyle = "rgba(0,0,0,.35)"; g.stroke();
      g.fillStyle = acc; g.beginPath(); g.moveTo(cx - 5 * dpr, top + 4 * dpr); g.lineTo(cx, top + s / 2); g.lineTo(cx - 5 * dpr, top + s - 4 * dpr); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(cx + 5 * dpr, top + 4 * dpr); g.lineTo(cx, top + s / 2); g.lineTo(cx + 5 * dpr, top + s - 4 * dpr); g.closePath(); g.fill();
    }));
    if (trim && dt > 0) track(() => { g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(X(D), y, W, rows[0]); }); // past the song's end: cut
    y += rows[0] + gap;
    const bar = (a: number, b: number, s: string, col: string, h: number) => track(() => { const x0 = X(a), x1 = X(b); g.fillStyle = col; rr(x0, y + dpr, x1 - x0, h - 2 * dpr, 5 * dpr); g.fill(); g.save(); g.beginPath(); g.rect(x0, y, x1 - x0, h); g.clip(); g.fillStyle = "#fff"; g.fillText(s, Math.max(x0, lab) + 6 * dpr, y + h / 2); g.restore(); });
    label("Text", rows[1]);
    if (st.hook) bar(0, Math.min(D, 2.2), st.hook, "#5a4a7e", rows[1]);
    for (const o of st.overlays) bar(o.all ? 0 : o.t0, o.all ? D : o.t1, o.text, "#4A3E6A", rows[1]);
    if (st.capsOn) bar(Math.min(D, 2.4), D, "Captions", "#3e4a6a", rows[1]);
    y += rows[1] + gap;
    label("Voice", rows[2]);
    if (st.vo || st.kind === "talk") bar(0, D, st.kind === "talk" ? "Your voice · pauses cut" : "Voiceover · cleaned", "#2E5A47", rows[2]);
    y += rows[2] + gap;
    label("Music", rows[3]);
    if (st.songName && st.audio) {
      // the song as a waveform (louder = taller), its beats as marks, zoomed with every other track (they stay in sync)
      const h = rows[3], mid = y + h / 2, pk = songPeaks(st.audio);
      track(() => {
        g.fillStyle = "#3b3122"; rr(X(0), y + dpr, X(D) - X(0), h - 2 * dpr, 5 * dpr); g.fill();
        g.fillStyle = "#e0b45c";
        for (let px = Math.max(lab, X(0)); px < Math.min(W, X(D)); px += dpr) {
          const a = Math.max(0, Math.floor((t0 + (px - lab) / pps) / PEAK_DT)), b = Math.min(pk.length, Math.ceil((t0 + (px + dpr - lab) / pps) / PEAK_DT));
          let m = 0; for (let k = a; k < Math.max(b, a + 1) && k < pk.length; k++) if (pk[k] > m) m = pk[k];
          const hh = Math.max(dpr, m * (h / 2 - 3 * dpr)); g.fillRect(px, mid - hh, dpr, hh * 2);
        }
        g.fillStyle = "rgba(255,255,255,.75)";
        for (const bt of st.beats) if (bt >= t0 && bt <= t0 + D / zoom) g.fillRect(Math.round(X(bt)), y + dpr, dpr, 5 * dpr);
        g.fillStyle = "#fff"; g.fillText("♪ " + st.songName, Math.max(X(0), lab) + 6 * dpr, y + 9 * dpr);
      });
    } else if (st.songName) bar(0, D, "♪ " + st.songName, "#5b4b30", rows[3]);
    else track(() => { g.fillStyle = chip; rr(lab, y + dpr, W - lab, rows[3] - 2 * dpr, 5 * dpr); g.fill(); });
    if (now >= t0 && now <= t0 + D / zoom) { g.fillStyle = ink; g.fillRect(Math.round(X(now)) - dpr, 0, 2 * dpr, H); }
  };
  window.addEventListener("resize", () => { lanesKey = ""; if (wide() && !tool && made()) { tool = defTool(); apply(); } const st = S() as (Studio & { drawTimeline?: () => void }) | undefined; if (st && st.edit.length) st.drawTimeline?.(); }, sig);
  // fingers and the mouse: one pointer drags an edge, moves along (when zoomed) or taps; two pointers pinch
  const pts = new Map<number, number>(); // pointer id -> x
  let pinch: { d0: number; z0: number; tm: number; f: number } | null = null, pan: { x: number; t0: number; moved: boolean } | null = null;
  const spread = () => { const xs = [...pts.values()]; return { d: Math.abs(xs[0] - xs[1]) || 1, m: (xs[0] + xs[1]) / 2 }; };
  lanes.addEventListener("pointerdown", (e) => {
    const st = S(); if (!st || !st.dur) return;
    if (e.isPrimary) { pts.clear(); pinch = null; } // a new gesture: nothing left over from one that never ended
    try { lanes.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
    pts.set(e.pointerId, e.clientX);
    if (pts.size === 2) { const { d, m } = spread(), r = lanes.getBoundingClientRect(); trim = null; pan = null; pinch = { d0: d, z0: zoom, tm: tAt(m), f: (m - r.left - labW()) / (r.width - labW()) }; return; }
    const k = edgeAt(e.clientX, e.clientY);
    if (k >= 0) { trim = { i: k, to: st.edit[k].end }; lanesKey = ""; return; }
    pan = { x: e.clientX, t0, moved: false };
  }, sig);
  lanes.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) { lanes.style.cursor = edgeAt(e.clientX, e.clientY) >= 0 ? "col-resize" : hitAt(e.clientX, e.clientY) ? "pointer" : "default"; const t = infoAt(e.clientX, e.clientY); if (lanes.title !== t) lanes.title = t; return; }
    pts.set(e.pointerId, e.clientX);
    const st = S(); if (!st) return;
    if (pinch && pts.size === 2) { const { d } = spread(); zoom = pinch.z0 * (d / pinch.d0); fix(); t0 = pinch.tm - pinch.f * span(); fix(); return; }
    if (trim) { trim.to = Math.max(st.edit[trim.i].start + 0.3, Math.min(st.dur - 0.3, tAt(e.clientX))); lanesKey = ""; return; }
    if (pan) { const r = lanes.getBoundingClientRect(), dx = e.clientX - pan.x; if (Math.abs(dx) > 4) pan.moved = true; t0 = pan.t0 - (dx / (r.width - labW())) * span(); fix(); }
  }, sig);
  const up = (e: PointerEvent) => {
    if (!pts.delete(e.pointerId)) return;
    const st = S();
    if (pinch) { if (pts.size < 2) pinch = null; pan = null; return; }
    if (trim && st && e.type === "pointerup" && Math.abs(trim.to - st.edit[trim.i].end) >= 0.02) { const t = trim; trim = null; st.shotRipple(t.i, t.to); shotKey = ""; }
    else if (trim && st && e.type === "pointerup") { trim = null; pan = { x: e.clientX, t0, moved: false }; } // pressed, not dragged: a tap
    if (pan && !pan.moved && st && e.type === "pointerup") {
      // a tap on a transition, an effect or a speed: that shot, its tab open in the Shot tool; elsewhere: the playhead
      const hit = hitAt(e.clientX, e.clientY);
      if (hit) {
        void st.kfSeek(st.edit[hit.k].start + 0.05);
        shotTab = hit.tab; shotKey = "";
        if (tool !== "shots") { tool = "shots"; apply(); }
      } else void st.kfSeek(Math.max(0, Math.min(st.dur - 0.01, tAt(e.clientX))));
    }
    trim = null; pan = null; lanesKey = "";
  };
  lanes.addEventListener("pointerup", up, sig);
  lanes.addEventListener("pointercancel", up, sig);
  // a touchpad: a pinch arrives as a wheel with Ctrl; a sideways swipe moves along
  lanes.addEventListener("wheel", (e) => {
    const st = S(); if (!st || !st.dur) return;
    const r = lanes.getBoundingClientRect(), f = (e.clientX - r.left - labW()) / (r.width - labW());
    if (e.ctrlKey) { e.preventDefault(); const tm = tAt(e.clientX); zoom *= Math.exp(-e.deltaY * 0.012); fix(); t0 = tm - f * span(); fix(); }
    else if (zoom > 1 && (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey)) { e.preventDefault(); t0 += ((e.deltaX || e.deltaY) / (r.width - labW())) * span(); fix(); }
  }, { passive: false, signal: ac.signal });

  // the times, the shot, the lanes: kept up to date while the page is open (each redraws only on a change)
  let raf = 0;
  const tick = () => {
    const st = S();
    if (st && made()) {
      setText($("tcur"), fmt(st.now)); setText($("ttot"), fmt(st.dur));
      if (root.classList.contains("playing") !== st.playing) root.classList.toggle("playing", st.playing);
      shotUI(); clipUI(); drawLanes();
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  // fold the song and clips once the Reel is made (tap the line to open them again)
  let wasMade = made();
  const onChange = () => {
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
  fetch("/api/credits", { credentials: "same-origin", ...sig }).then((r) => (r.ok ? r.json() : null)).then((c: { enabled?: boolean; plan?: string } | null) => {
    paid = !!c && (c.enabled === false || (!!c.plan && c.plan !== "free"));
    apply();
  }, () => {});
  return { cleanup: () => { ac.abort(); mo.disconnect(); cancelAnimationFrame(raf); } };
}
