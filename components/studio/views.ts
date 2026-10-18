/** Fast Studio's three views of the same Reel, on the markup of components/studio/markup.ts (the editing itself is the
 * engine's; everything here shows, hides or forwards to the engine's own controls):
 * - Simple: the preview with a summary, four cards (Style, Text, Look, Music) that open their panels, a "Save video" bar.
 * - Editor: the timeline strip, the current shot as chips, a tool dock showing one panel at a time.
 * - Pro: the shot inspector beside the preview, a multi-track timeline (video, text, voice, music), grouped tools.
 * Also: the song and clips steps fold into one line once the Reel is made, the top bar's title and Export, the home
 * screen's style library. */

export type StudioView = "simple" | "editor" | "pro" | "all"; // "all": every panel open (checks and support, by link only)
export const VIEW_KEY = "studio-view";

type Shot = { start: number; end: number; src: number; type: string; tr: string; efx: string; uk?: { t: number }[] };
type Ov = { t0: number; t1: number; all?: boolean; text: string; emoji?: boolean };
type Studio = {
  now: number; playing: boolean; dur: number; songName: string; title: string; hook: string; capsOn: boolean;
  edit: Shot[]; overlays: Ov[]; vo: unknown; kind: string; editGen: number;
  sources: { name: string }[]; shotCs: ClipApi["shotCs"]; shotSet: ClipApi["shotSet"]; shotSlip: ClipApi["shotSlip"]; shotTrim: ClipApi["shotTrim"]; shotExtract: ClipApi["shotExtract"]; shotOp: (op: "split" | "dup" | "delete" | "replace", arg?: number) => boolean;
  section: { start: number; len: number; whole: number; auto: boolean };
  segAt: (t: number) => number; kfSeek: (t: number) => Promise<void>;
};

export function savedView(): StudioView {
  try {
    const q = new URLSearchParams(location.search).get("view"); // a link can open a view: /studio?view=pro
    if (q === "simple" || q === "editor" || q === "pro" || q === "all") return q;
    const v = localStorage.getItem(VIEW_KEY);
    return v === "editor" || v === "pro" ? v : "simple";
  } catch {
    return "simple";
  }
}

// which panels a tool opens (Simple's cards and Pro's tools are groups; the Editor's dock opens one panel each)
const GROUPS: Record<string, string[]> = {
  "simple:style": ["style"], "simple:text": ["text", "captions"], "simple:look": ["look", "bg"], "simple:music": ["music", "voice"],
  "pro:pshot": ["motion", "shots"], "pro:text": ["text", "captions"], "pro:audio": ["music", "voice"], "pro:plook": ["look", "style"], "pro:bg": ["bg"],
};
const PRO_OF: Record<string, string> = { layers: "layers", shots: "pshot", motion: "pshot", music: "audio", voice: "audio", captions: "text", look: "plook", style: "plook", bg: "bg", text: "text" };
const SIMPLE_OF: Record<string, string> = { style: "style", text: "text", captions: "text", look: "look", bg: "look", music: "music", voice: "music", audio: "music", plook: "look" };
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
  let view: StudioView = savedView();
  let tool = "";
  let shotKey = "", lanesKey = "", shotTab = 0, ctOpen = "", ctKey = "";
  const q = new URLSearchParams(location.search).get("tool");

  const made = () => !$("s3").classList.contains("locked");
  const defTool = () => (view === "editor" ? "shots" : view === "pro" ? "pshot" : "");
  const panelsOf = () => (!tool ? [] : GROUPS[view + ":" + tool] || [tool]);
  const apply = () => {
    root.classList.remove("v-simple", "v-editor", "v-pro", "v-all");
    root.classList.add("v-" + view);
    root.dataset.tool = tool;
    root.classList.toggle("made", made());
    root.querySelectorAll<HTMLButtonElement>("#views button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === view)));
    root.querySelectorAll<HTMLButtonElement>(".tool").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tool === tool)));
    root.querySelectorAll<HTMLButtonElement>(".card").forEach((b) => b.setAttribute("aria-expanded", String(b.dataset.tool === tool)));
    const on = new Set(view === "all" ? [...root.querySelectorAll<HTMLElement>(".panel")].map((p) => p.dataset.panel!) : panelsOf());
    root.querySelectorAll<HTMLElement>(".panel").forEach((p) => p.classList.toggle("on", on.has(p.dataset.panel!)));
    // the keyframe panel is open when Motion is shown (dragging the picture then moves the shot)
    const kfWant = on.has("motion");
    if (kf.open !== kfWant) kf.open = kfWant;
    if (view === "pro" || view === "all") $<HTMLDetailsElement>("allshots").open = true;
    shotKey = ""; lanesKey = "";
    requestAnimationFrame(() => { const st = S() as (Studio & { drawTimeline?: () => void }) | undefined; if (st && st.edit.length) st.drawTimeline?.(); });   // the strip at its new size
  };
  const setView = (v: StudioView) => {
    const was = tool; // the same tool in the new view, where it exists there
    view = v;
    if (v === "pro") tool = PRO_OF[was] || "pshot";
    else if (v === "editor") tool = (GROUPS["pro:" + was] || GROUPS["simple:" + was] || [was])[0] || "shots";
    else tool = SIMPLE_OF[was] && was !== "shots" ? "" : "";
    try { if (v !== "all") localStorage.setItem(VIEW_KEY, v); } catch { /* private mode */ }
    apply();
    onView(v);
  };
  const openStep = (id: string, open: boolean) => {
    const s = $(id), h = s.querySelector<HTMLButtonElement>(".sh")!;
    s.classList.toggle("folded", !open);
    h.setAttribute("aria-expanded", String(open));
  };
  const copyReel = () => root.querySelector<HTMLButtonElement>('#mode [data-m="copy"]')?.click();

  $("views").addEventListener("click", (e) => { const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-view]"); if (b) setView(b.dataset.view as StudioView); }, sig);
  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const go = t.closest<HTMLElement>("[data-goview]"); if (go) { setView(go.dataset.goview as StudioView); return; }
    const px = t.closest<HTMLElement>("[data-proxy]"); if (px) { $(px.dataset.proxy!).click(); return; }
    const os = t.closest<HTMLElement>("[data-open-step]"); if (os) { const id = os.dataset.openStep!; openStep(id, true); $(id).scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    if (t.closest("#copycard,#teach")) { copyReel(); return; }
    const b = t.closest<HTMLButtonElement>(".tool,.card");
    if (b) {
      const k = b.dataset.tool!;
      tool = b.classList.contains("card") && tool === k ? "" : k; // a card closes again on a second tap
      apply();
      if (b.classList.contains("card") && tool) root.querySelector<HTMLElement>(".panel.on")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    const sh = t.closest<HTMLButtonElement>(".step > .sh");
    if (sh) { const s = sh.parentElement!; openStep(s.id, s.classList.contains("folded")); }
  }, sig);

  // play over the preview (Simple), previous / next shot
  $("playov").addEventListener("click", () => $("play").click(), sig);
  const jump = (d: number) => { const st = S(); if (!st || !st.edit.length) return; const i = Math.max(0, Math.min(st.edit.length - 1, st.segAt(st.now) + d)); void st.kfSeek(st.edit[i].start + 0.05); };
  $("pshot").addEventListener("click", () => jump(-1), sig);
  $("nshot").addEventListener("click", () => jump(1), sig);

  // the top bar's Export is the same button as the save bar's
  const exp = $<HTMLButtonElement>("export"), top = $<HTMLButtonElement>("topexport");
  top.addEventListener("click", () => exp.click(), sig);
  const mirror = () => { if (top.disabled !== exp.disabled) top.disabled = exp.disabled; }; // only on a change: a write is a mutation too

  // the cards, the title and the summary show what is chosen now
  const pressed = (id: string) => root.querySelector(`#${id} [aria-pressed="true"]`)?.textContent?.trim() || "";
  const setText = (el: Element | null, v: string) => { if (el && el.textContent !== v) el.textContent = v; };
  const cv = (k: string, v: string) => setText(root.querySelector(`[data-cv="${k}"]`), v);
  const values = () => {
    const st = S();
    const ref = !$("refbox").hidden && pressed("mode") === "Copy a Reel";
    cv("style", ref ? "Copied Reel" : pressed("mode"));
    const hook = $<HTMLInputElement>("hook").value.trim(), n = root.querySelectorAll("#ovlist .ov").length, caps = $<HTMLInputElement>("caps").checked;
    cv("text", (hook ? "“" + (hook.length > 14 ? hook.slice(0, 13) + "…" : hook) + "”" : n ? n + " text" + (n > 1 ? "s" : "") : "Add a hook") + (caps ? " + captions" : ""));
    const bgm = pressed("bgmode");
    cv("look", pressed("look") + (bgm && bgm !== "Original" ? " · " + bgm.toLowerCase() + " background" : ""));
    if (st && st.dur) cv("music", fmtS(st.dur) + (st.section && st.section.len && st.section.auto ? " · best part" : "") + (!$("vodel").hidden ? " · voiceover" : ""));
    else cv("music", "Choose a song");
    if (st && made()) {
      setText($("tbname"), st.title || "Fast Studio");
      const talk = st.kind === "talk";
      const info = fmtS(st.dur) + " · " + st.edit.length + (talk ? " parts, pauses cut" : " shots") + (st.songName && !talk ? " on the beat of " : "");
      const si = $("suminfo");
      if (si.dataset.k !== info + st.songName) { si.dataset.k = info + st.songName; si.textContent = info; if (st.songName && !talk) { const b = document.createElement("b"); b.textContent = st.songName; si.append(b); } }
      const sec = st.section, part = sec && sec.whole && sec.len < sec.whole - 0.5 ? " · " + fmtS(sec.start) + "–" + fmtS(sec.start + sec.len) : "";
      setText($("tlmusic"), st.songName ? "♪ " + st.songName + part + " · beats marked" : talk ? "The voice of your clips" : "");
    } else setText($("tbname"), "Fast Studio");
  };

  // the current shot: chips (Editor) and the inspector (Pro), both forwarding to the edit list's own controls
  const rowOf = (i: number) => root.querySelectorAll<HTMLTableRowElement>("#edl tr")[i];
  const shotUI = () => {
    const st = S(); if (!st || !made() || !st.edit.length || view === "simple") return;
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
      else { const op = t.closest<HTMLButtonElement>("[data-op]"); if (op) { S()?.shotOp(op.dataset.op as "split" | "dup" | "delete"); shotKey = ""; } } }, sig);
    clipToolsEvents($(id), () => S(), () => ctOpen, (k) => { ctOpen = k; }, () => clipUI(true), sig);
    $(id).addEventListener("change", (e) => { const s = e.target as HTMLSelectElement; if (s.dataset.c) forward(+s.dataset.c, s.value);
      else if (s.dataset.rep && s.value !== "") { S()?.shotOp("replace", +s.value); shotKey = ""; } }, sig);
  }

  // Pro: the multi-track timeline (video with keyframes, text, voice, music); tap to move the playhead
  const lanes = $<HTMLCanvasElement>("lanes");
  const css = (v: string, d: string) => getComputedStyle(root).getPropertyValue(v).trim() || d;
  const drawLanes = () => {
    const st = S(); if (!st || view !== "pro" || !made() || !st.edit.length || !lanes.clientWidth) return;
    const D = st.dur || 1, now = st.now;
    const key = [lanes.clientWidth, st.editGen, st.edit.length, (now * 20) | 0, st.overlays.map((o) => o.t0 + "/" + o.t1 + o.text).join(), !!st.vo, st.hook, st.capsOn, st.edit.reduce((a, e) => a + (e.uk ? e.uk.length : 0), 0), root.querySelectorAll("#edl tr").length].join("|");
    if (key === lanesKey) return; lanesKey = key;
    const dpr = window.devicePixelRatio || 1, wide = lanes.clientWidth > 700, lab = (wide ? 64 : 46) * dpr;
    const rows = [wide ? 46 : 38, 24, 24, 24].map((h) => h * dpr), gap = 5 * dpr, rul = wide ? 18 * dpr : 0;
    const W = Math.round(lanes.clientWidth * dpr), H = Math.round(rul + rows.reduce((a, b) => a + b, 0) + gap * 3);
    if (lanes.width !== W) lanes.width = W; if (lanes.height !== H) { lanes.height = H; lanes.style.height = H / dpr + "px"; }
    const g = lanes.getContext("2d")!; g.clearRect(0, 0, W, H);
    const ink = css("--foreground", "#f3ede3"), muted = css("--muted", "#a69d90"), acc = css("--accent", "#d4b07a"), chip = css("--surface-2", "#1c1916");
    const X = (t: number) => lab + (t / D) * (W - lab);
    g.font = `${11 * dpr}px system-ui, sans-serif`; g.textBaseline = "middle";
    if (rul) { g.fillStyle = muted; const step = D > 40 ? 10 : 5; for (let t = 0; t < D; t += step) g.fillText(fmtS(t), X(t) + 2 * dpr, rul / 2); }
    let y = rul;
    const label = (s: string, h: number) => { g.fillStyle = muted; g.fillText(s, 2 * dpr, y + h / 2); };
    const rr = (x: number, yy: number, w: number, h: number, r: number) => { g.beginPath(); if (g.roundRect) g.roundRect(x, yy, Math.max(1, w), h, r); else g.rect(x, yy, Math.max(1, w), h); };
    label("Video", rows[0]);
    const cur = st.segAt(now);
    st.edit.forEach((e, k) => {
      const x0 = X(e.start) + dpr, x1 = X(e.end) - dpr; g.fillStyle = CLIP_COL[e.src % CLIP_COL.length]; rr(x0, y, x1 - x0, rows[0], 5 * dpr); g.fill();
      if (k === cur) { g.lineWidth = 2 * dpr; g.strokeStyle = acc; g.stroke(); }
      for (const kq of e.uk || []) { const kx = X(e.start + kq.t), ky = y + rows[0] - 7 * dpr, r = 4 * dpr; g.beginPath(); g.moveTo(kx, ky - r); g.lineTo(kx + r, ky); g.lineTo(kx, ky + r); g.lineTo(kx - r, ky); g.closePath(); g.fillStyle = "#6FA8FF"; g.fill(); }
    });
    y += rows[0] + gap;
    const bar = (a: number, b: number, s: string, col: string, h: number) => { const x0 = X(a), x1 = X(b); g.fillStyle = col; rr(x0, y + dpr, x1 - x0, h - 2 * dpr, 5 * dpr); g.fill(); g.save(); g.beginPath(); g.rect(x0, y, x1 - x0, h); g.clip(); g.fillStyle = "#fff"; g.fillText(s, x0 + 6 * dpr, y + h / 2); g.restore(); };
    label("Text", rows[1]);
    if (st.hook) bar(0, Math.min(D, 2.2), st.hook, "#5a4a7e", rows[1]);
    for (const o of st.overlays) bar(o.all ? 0 : o.t0, o.all ? D : o.t1, o.text, "#4A3E6A", rows[1]);
    if (st.capsOn) bar(Math.min(D, 2.4), D, "Captions", "#3e4a6a", rows[1]);
    y += rows[1] + gap;
    label("Voice", rows[2]);
    if (st.vo || st.kind === "talk") bar(0, D, st.kind === "talk" ? "Your voice · pauses cut" : "Voiceover · cleaned", "#2E5A47", rows[2]);
    y += rows[2] + gap;
    label("Music", rows[3]);
    if (st.songName) bar(0, D, "♪ " + st.songName, "#5b4b30", rows[3]);
    else { g.fillStyle = chip; rr(lab, y + dpr, W - lab, rows[3] - 2 * dpr, 5 * dpr); g.fill(); }
    g.fillStyle = ink; g.fillRect(Math.round(X(Math.min(now, D))) - dpr, 0, 2 * dpr, H);
  };
  window.addEventListener("resize", () => { lanesKey = ""; const st = S() as (Studio & { drawTimeline?: () => void }) | undefined; if (st && st.edit.length) st.drawTimeline?.(); }, sig);
  lanes.addEventListener("pointerdown", (e) => {
    const st = S(); if (!st || !st.dur) return; const r = lanes.getBoundingClientRect(), lab = r.width > 700 ? 64 : 46;
    void st.kfSeek(Math.max(0, Math.min(st.dur - 0.01, ((e.clientX - r.left - lab) / (r.width - lab)) * st.dur)));
  }, sig);

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

  // home: the style library (kinds with Reels saved, how well each is learned); tap one to use it
  const KINDS: Record<string, string> = { wedding: "Wedding", travel: "Travel", festival: "Festival", dance: "Dance", talking: "Talking", product: "Product", food: "Food", fitness: "Fitness", vlog: "Vlog", birthday: "Birthday", other: "Other" };
  (async () => {
    try {
      const r = await fetch("/api/studio/styles", { credentials: "same-origin" }); if (!r.ok) return;
      const d = (await r.json()) as { categories?: Record<string, { mine: number; shared: number }> };
      const kinds = Object.entries(d.categories || {}).filter(([, c]) => c.mine + c.shared > 0).sort((a, b) => b[1].mine + b[1].shared - (a[1].mine + a[1].shared)).slice(0, 4);
      const list = $("slist"); list.innerHTML = "";
      for (const [k, c] of kinds) {
        const b = document.createElement("button"); b.type = "button"; b.className = "skind";
        b.innerHTML = `<span><b></b><small></small></span><span class="pct"></span>`;
        b.querySelector("b")!.textContent = KINDS[k] || k;
        b.querySelector("small")!.textContent = c.mine + c.shared + " Reels" + (c.shared ? " · " + c.mine + " mine" : "");
        b.addEventListener("click", () => { $<HTMLSelectElement>("lcat").value = k; $("luse").click(); });
        list.append(b);
        fetch("/api/studio/styles/learned?category=" + k + "&scope=all").then((x) => (x.ok ? x.json() : null)).then((x: { accuracy?: { learned?: number } | number | null } | null) => {
          const a = x && x.accuracy, v = typeof a === "number" ? a : a && typeof a === "object" ? a.learned : null;
          if (v != null) b.querySelector(".pct")!.textContent = Math.round(v * 100) + "%";
        }).catch(() => {});
      }
      $("stylelib").hidden = false;
    } catch { /* no server or signed out: no style library on the home screen */ }
  })();

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
  if (q) tool = view === "pro" ? PRO_OF[q] || tool : view === "simple" ? SIMPLE_OF[q] || "" : root.querySelector(`.panel[data-panel="${q}"]`) ? q : tool;
  apply(); onChange(); onView(view);
  return { setView, cleanup: () => { ac.abort(); mo.disconnect(); cancelAnimationFrame(raf); } };
}
