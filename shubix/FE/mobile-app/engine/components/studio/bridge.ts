import { noteSignedIn } from "@/lib/boot";
import { copyOfState, reelFromCopy } from "@/brain/index";
/* The phone app's way into Fast Studio (app/engine: the studio on a page the phone keeps hidden, FE/mobile-app
 * lib/engine.tsx). The phone's screens are its own; the Reel is made here, by this very engine, so it is the same Reel
 * as on the website. The phone asks with window.engine.call(id, op, args); the answers go back with
 * ReactNativeWebView.postMessage({ id, ok, result | error }), and everything the studio is doing (its task cards:
 * "studio-task") as { event: "task", ... }. The bridge works the studio as a person does: the files go into its file
 * inputs, the choices are its buttons. The phone's files come from its own little server (FileServer.kt), the finished
 * Reel goes back to it. Ops:
 *   setup { files: "http://127.0.0.1:port", key, token } where the files are; the sign-in for the API
 *   song { path, name }                                  the song (the website analyses it and checks its beats)
 *   clips { paths: [{ path, name }] }                     the clips (read: motion, scenes, faces, the best moments) -> { clips, names: the ones it kept, in its order }
 *   choose { length?, order?, aspect?, mode? }            Reel length (0 / 15 / 30 / 60 / seconds), "mix" | "order", 9:16…, auto | smooth | fast
 *                                                         -> { start }: where the song's part starts (Shubix picks the best part)
 *   part { start }                                       the part dragged on the waves: from there -> { start }
 *   ready {}                                              waits until the Reel is made -> the work and the Reel's shots
 *   state {} / exportReel { name }                        the Reel as the studio saves it / the MP4, sent back -> its path on the phone
 *   edit { shots }                                        the Reel's shots as the phone's editor changed them (its state's edit) -> { ok }
 *   set { box, attr?, value }                              a choice in a tool: its button attr=value in #box, or the input #box set to value -> as ready
 *   answer { pick: "ok" | "no" | "close" }               the phone's answer to the studio's question (Shubix AI's credits)
 * The studio's questions (askCredits: "Shubix AI will edit this Reel", Use 10 credits) go to the phone as
 * { event: "ask", title, text, list, balance, ok, no }; the phone shows them as its own and answers. */

type KeyframeTarget = { what?: string; a?: number; i?: number; obj?: { uk?: Array<Record<string, unknown> & { t: number }> } } | null;
type StudioLayer = { id?: number; t0?: number; t1?: number; x?: number; y?: number; s?: number; op?: number; r?: number; mask?: string; blend?: string; follow?: string; followOffsetX?: number; followOffsetY?: number; mk?: { w?: number; h?: number; f?: number; th?: number; a?: number; inv?: boolean }; key?: { on?: boolean; c?: string; tol?: number } };
type Studio = { sources: { name: string }[]; section: { start: number }; setPart: (t: number) => Promise<void>; songR?: { period: number; beats: number[]; cutType: string[] }; dur: number; work: { songReady: boolean; beats: boolean; pending: number; clips: number; shots: number; ai: boolean; dir: boolean; exporting: boolean }; editGen: number; state: () => unknown; setEdit: (list: unknown[]) => boolean; autoExport: (cloud?: boolean) => Promise<Blob | null>; exportLocked: () => { name: string; need: string }[]; exportFix: () => void; caption: () => string; edit: unknown[]; beats: number[]; mode: string; now: number; segAt: (t: number) => number; shotCs: () => unknown; shotSet: (patch: unknown) => void; shotOp: (op: string, arg?: unknown) => boolean; shotSlip: (delta: number) => boolean; shotTrim: (direction: number) => boolean; shotExtract: () => unknown; shotReverse: () => Promise<boolean>; seek: (time: number) => Promise<unknown>; kfSeek: (time: number) => Promise<unknown>; kfSet: (values: Record<string, number>) => void; kfTarget: () => KeyframeTarget; layerAdd: (files: File[]) => Promise<void>; layerSelect: (index: number) => boolean | Promise<boolean>; layerSet: (key: string, value: unknown) => void; layerDelete: () => boolean; layers: StudioLayer[]; setAudioMix: (patch: { mvol?: number; mfin?: number; mfout?: number }) => Promise<unknown>; remix: () => boolean; saveNow: () => unknown; ttsVoices: Array<{ key: string; label: string }>; addTts: (text: string, voice: string) => Promise<unknown>; clearTts: () => boolean; setCaptions: (enabled: boolean, language?: string, translation?: string) => Promise<unknown>; setCaptionStyle: (style: string) => string; setOverlays: (list: Array<Record<string, unknown>>) => number };
type Native = { postMessage: (m: string) => void };

type PhoneFiles = { base: string; key: string; paths: Record<string, string> };
export function initBridge(root: HTMLElement): () => void {
  // the phone's side (found when it is needed: the phone sets it up with the page)
  const post = (m: object) => (window as unknown as { ReactNativeWebView?: Native }).ReactNativeWebView?.postMessage(JSON.stringify(m));
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>("#" + id);
  const studio = () => (root as unknown as { __studio?: Studio }).__studio;
  let files = "", key = "", reading = false;

  // the phone's sign-in on the API's requests (the page has no sign-in cookie)
  const send = window.fetch.bind(window);
  let token = "";
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (token && new URL(url, location.href).origin === location.origin && new URL(url, location.href).pathname.startsWith("/api/")) {
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      if (!headers.has("Authorization")) headers.set("Authorization", "Bearer " + token);
      return send(input, { ...init, headers });
    }
    return send(input, init);
  };

  // what the phone's own player needs to draw a layer (StudioLayers.kt); no path: a layer it cannot read (an old project)
  const nativeLayer = (layer: Record<string, unknown>) => {
    const media = (studio() as unknown as { layerMedia?: { file?: File; kind?: string }[] } | undefined)?.layerMedia?.[Number(layer.m)], file = media?.file;
    const path = file && (window as unknown as { __phone?: PhoneFiles }).__phone?.paths[`${file.name}|${file.size}`];
    return path ? { path, kind: media.kind, t0: layer.t0, t1: layer.t1, in: layer.in, x: layer.x, y: layer.y, s: layer.s, r: layer.r, op: layer.op, fh: layer.fh, fv: layer.fv, fin: layer.fin, fout: layer.fout, crop: layer.crop, mask: layer.mask, mk: layer.mk, rad: layer.rad } : null;
  };
  const fileOf = async (path: string, name: string) => {
    const r = await send(`${files}/f?k=${key}&p=${encodeURIComponent(path)}`);
    if (!r.ok) throw new Error(`The phone could not give ${name} (${r.status})`);
    const b = await r.blob();
    // the phone's own decoder reads this clip from its path (engine.ts clipReader)
    (window as unknown as { __phone?: PhoneFiles }).__phone = { base: files, key, paths: { ...(window as unknown as { __phone?: PhoneFiles }).__phone?.paths, [`${name}|${b.size}`]: path } };
    return new File([b], name, { type: b.type || "application/octet-stream", lastModified: Date.now() });
  };
  const put = (input: HTMLInputElement | null, list: File[]) => {
    if (!input) throw new Error("The studio is not ready");
    const dt = new DataTransfer(); list.forEach((f) => dt.items.add(f));
    input.files = dt.files; input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const press = (box: string, attr: string, value: string) => { const b = root.querySelector<HTMLElement>(`#${box} [${attr}="${value}"]`); if (b) b.click(); return !!b; };
  // the website's Export sheet, opened (it reads the plan and the phone) or closed, unseen here
  const sheet = async (open: boolean) => { $(open ? "export" : "xshclose")?.click(); await new Promise((r) => setTimeout(r, 150)); };
  // the phone's choices put into the open sheet: quality, frame rate, the watermark, without the song, My Reels
  const pick = (a: Record<string, unknown>) => {
    if (a.res) press("xres", "data-r", String(a.res));
    if (a.fps) press("xfps", "data-f", String(a.fps));
    for (const [id, on] of [["xwm", a.noWatermark], ["nosong", a.noSong], ["xmy", a.myReels]] as const) {
      const box = $<HTMLInputElement>(id);
      if (box && on !== undefined && !box.disabled && box.checked !== !!on) { box.checked = !!on; box.dispatchEvent(new Event("change", { bubbles: true })); }
    }
  };
  const until = async (test: () => boolean, ms = 600_000) => { const t0 = Date.now(); while (!test()) { if (Date.now() - t0 > ms) throw new Error("The studio took too long"); await new Promise((r) => setTimeout(r, 250)); } };
  // made: the song read, the clips read, the shots there, and Shubix AI done with them (its clips' check, the pace, the plan)
  const made = () => { const w = studio()?.work as (Studio["work"] & { pace?: boolean; aiWait?: boolean }) | undefined; return !!w && w.songReady && !w.pending && w.shots > 0 && !w.ai && !w.dir && !w.pace && !w.aiWait; };

  const OPS: Record<string, (a: Record<string, unknown>) => Promise<unknown>> = {
    async setup(a) {
      files = String(a.files); key = String(a.key); token = String(a.token || ""); if (token) noteSignedIn();
      await until(() => !!studio(), 60_000);
      // the studio started before the phone's sign-in reached it: its plan, credits and Shubix AI are read again now
      // (else the app's Reels were made as signed out: no Shubix AI, the free plan's rules)
      const st = studio() as unknown as { account?: () => Promise<void>; aiOn?: boolean };
      if (token && st.account) await st.account().catch(() => undefined);
      return { ok: true, ai: !!st.aiOn };
    },
    async song(a) {
      const st = studio(), previous = st?.songR;
      const name = String(a.name);
      put($("mfile"), [await fileOf(String(a.path), name)]);
      await until(() => !!studio()?.work.songReady && !!studio()?.songR && studio()?.songR !== previous);
      const current = studio()!, r = current.songR!, n = (k: string) => r.cutType.filter((t) => t === k).length;
      return { duration: current.dur, bpm: Math.round(60 / r.period), beats: r.beats.length, drops: n("drop"), breaks: n("break") };
    },
    async clips(a) {
      const list = a.paths as { path: string; name: string }[], got: File[] = [];
      for (const c of list) got.push(await fileOf(c.path, c.name));
      // the studio may leave a clip out (one it cannot play, the same footage twice): done when its reading is over
      // a new Reel: the last Reel's clips go first (the studio's file box adds to what it has, as Add clips does)
      $("clearv")?.click();
      reading = true; put($("vfile"), got); await until(() => !reading && !studio()!.work.pending);
      return { clips: studio()!.work.clips, names: studio()!.sources.map((s) => s.name) };
    },
    async choose(a) {
      if (a.mode) press("mode", "data-m", String(a.mode));
      if (a.order) press("seq", "data-q", String(a.order));
      if (a.aspect) press("aspect", "data-a", String(a.aspect));
      if (a.length !== undefined) {
        const n = Number(a.length);
        if (!press("slen", "data-l", String(n))) { press("slen", "data-l", "c"); const i = $<HTMLInputElement>("slenc"); if (i) { i.value = String(n); i.dispatchEvent(new Event("change", { bubbles: true })); } }
      }
      await new Promise((r) => setTimeout(r, 400)); // the part is placed (useSection)
      return { mode: studio()?.mode, start: studio()?.section.start ?? 0 };
    },
    /** Next after the clips: Shubix AI's question (Use), then its work. `went`: false when the person closed the question */
    async ai() {
      const went = await (studio() as unknown as { upsell: () => Promise<string> }).upsell();
      if (went === "close") return { went: false };
      await until(made, 300_000);
      return { went: true };
    },
    async aiState() { return { on: !!(studio()!.work as unknown as { aiOn?: boolean }).aiOn }; },
    async ready() { await until(made); return { work: studio()!.work, state: studio()!.state() }; },
    async state() { return studio()?.state(); },
    async undo() {
      const st = studio(), button = $("undo");
      if (!st || !button || button.hasAttribute("disabled")) return { ok: false, state: st?.state() ?? null };
      button.click();
      return { ok: true, state: st.state() };
    },
    async redo() {
      const st = studio(), button = $("redo");
      if (!st || !button || button.hasAttribute("disabled")) return { ok: false, state: st?.state() ?? null };
      button.click();
      return { ok: true, state: st.state() };
    },
    async remix() {
      const st = studio();
      if (!st?.remix) throw new Error("Mix Video is not ready");
      const ok = st.remix();
      if (!ok) throw new Error("Add at least two usable clips before making a new mix");
      return { ok: true, state: st.state() };
    },
    async seek(a) { const st = studio(); if (!st?.seek) throw new Error("Studio seeking is not ready"); await st.seek(Math.max(0, Number(a.time) || 0)); return { time: st.now }; },
    async kfSeek(a) { const st = studio(); if (!st?.kfSeek) throw new Error("Keyframe timeline is not ready"); await st.kfSeek(Math.max(0, Number(a.time) || 0)); return st.kfTarget?.() ?? null; },
    async kfEase(a) {
      const st = studio(), select = $<HTMLSelectElement>("kfease");
      if (!st?.kfTarget?.() || !select) throw new Error("Select a keyframe first");
      select.value = String(a.easing || "inOut");
      select.dispatchEvent(new Event("change", { bubbles: true }));
      const target = st.kfTarget() as { i?: number; obj?: { uk?: Array<Record<string, unknown>> } };
      return { ok: true, index: target.i, keyframes: (target.obj?.uk || []).map((k) => ({ ...k })) };
    },
    async kfRemove() {
      const st = studio(), b = $("kfdel");
      if (!st || !b || b.hasAttribute("disabled")) throw new Error("There is no keyframe at the playhead");
      b.click(); const target = st.kfTarget() as { i?: number; obj?: { uk?: Array<Record<string, unknown>> } };
      return { ok: true, index: target.i, keyframes: (target.obj?.uk || []).map((k) => ({ ...k })) };
    },
    async kfClear() {
      const st = studio(), b = $("kfclear");
      if (!st || !b) throw new Error("Keyframe controls are not ready");
      b.click(); const target = st.kfTarget() as { i?: number; obj?: { uk?: Array<Record<string, unknown>> } };
      return { ok: true, index: target.i, keyframes: (target.obj?.uk || []).map((k) => ({ ...k })) };
    },
    async kfStep(a) {
      const st = studio(), target = st?.kfTarget?.();
      if (!st?.kfSeek || !target || target.what !== "shot") return { ok: false, time: st?.now ?? 0 };
      const local = (st.now ?? 0) - (target.a ?? 0), frames = target.obj?.uk || [];
      const next = Number(a.direction) < 0
        ? [...frames].filter((frame) => frame.t < local - 0.02).pop()
        : frames.find((frame) => frame.t > local + 0.02);
      if (!next) return { ok: false, time: st.now ?? 0 };
      await st.kfSeek((target.a ?? 0) + next.t);
      return { ok: true, time: st.now ?? 0 };
    },
    async kfSet(a) {
      const st = studio(), before = st?.kfTarget?.();
      if (!st?.kfSet || !before || before.what !== "shot") throw new Error("Select a video shot before adding keyframes");
      st.kfSet(a.values as Record<string, number>);
      const after = st.kfTarget?.();
      const obj = after && after.what === "shot" ? after.obj as { uk?: Array<Record<string, unknown>> } : null;
      return { ok: true, index: after?.i, keyframes: (obj?.uk || []).map((k) => ({ ...k })) };
    },
    async shotCs() { return studio()?.shotCs() ?? null; },
    async shotSet(a) {
      const st = studio();
      if (!st?.shotSet) throw new Error("The advanced clip tools are not ready");
      st.shotSet((a.patch ?? null) as unknown);
      return { ok: true, state: st.state() };
    },
    async shotOp(a) {
      const st = studio();
      if (!st?.shotOp) throw new Error("The clip operation is not ready");
      return { ok: !!st.shotOp(String(a.op), a.arg), state: st.state() };
    },
    async shotSlip(a) {
      const st = studio();
      if (!st?.shotSlip) throw new Error("Slip editing is not ready");
      return { ok: st.shotSlip(Number(a.delta) || 0), state: st.state() };
    },
    async shotTrim(a) {
      const st = studio();
      if (!st?.shotTrim) throw new Error("Beat trim is not ready");
      return { ok: st.shotTrim(Number(a.direction) || 1), state: st.state() };
    },
    async audioMix(a) {
      const st = studio();
      if (!st?.setAudioMix) throw new Error("Studio audio mixer is not ready");
      return await st.setAudioMix({
        ...(a.mvol !== undefined ? { mvol: Math.max(0, Math.min(1, Number(a.mvol))) } : {}),
        ...(a.mfin !== undefined ? { mfin: Math.max(0, Math.min(10, Number(a.mfin))) } : {}),
        ...(a.mfout !== undefined ? { mfout: Math.max(0, Math.min(10, Number(a.mfout))) } : {}),
      });
    },
    /** the Reel's picture at `t` seconds exactly as the studio makes it (its boxes, texts and their keyframes, looks,
     * transitions): the phone's paused preview shows it -> { src: a JPEG data URL, 540 wide } */
    async frame(a) {
      const st = studio() as unknown as { frameAt?: (t: number) => Promise<number> }, out = $<HTMLCanvasElement>("out");
      if (!st?.frameAt || !out) return { src: "" };
      await st.frameAt(Math.max(0, Number(a.t) || 0));
      const c = document.createElement("canvas"), w = Math.min(540, out.width);
      c.width = w; c.height = Math.round(out.height * w / out.width);
      c.getContext("2d")!.drawImage(out, 0, 0, c.width, c.height);
      return { src: c.toDataURL("image/jpeg", 0.75) };
    },
    /** a sound effect at `time` (the studio's Add buttons: whoosh, impact, laser...) -> { ok } */
    async sfx(a) {
      const st = studio(); if (st?.seek) await st.seek(Math.max(0, Number(a.time) || 0));
      return { ok: press("sfxadd", "data-sfx", String(a.kind)) };
    },
    /** the creator's own beat markers at `time`: add / del (the one there) / clear -> { ok, state } (the edit is made again) */
    async mark(a) {
      const st = studio(), id = ({ add: "addbeat", del: "delbeat", clear: "clrbeat" } as Record<string, string>)[String(a.op)], b = id ? $(id) : null;
      if (!st || !b) return { ok: false };
      if (st.seek) await st.seek(Math.max(0, Number(a.time) || 0));
      b.click(); await new Promise((r) => setTimeout(r, 300)); return { ok: true, state: st.state() };
    },
    /** a text template (a ready-made animated title) at `time` -> { ok, state } (its texts come back in state.overlays) */
    async template(a) {
      const st = studio(), s = $<HTMLSelectElement>("ovtpl"); if (!st || !s) return { ok: false };
      if (st.seek) await st.seek(Math.max(0, Number(a.time) || 0));
      s.value = String(a.key); if (s.value !== String(a.key)) return { ok: false };
      s.dispatchEvent(new Event("change")); return { ok: true, state: st.state() };
    },
    async layerList() {
      const st = studio();
      return (st?.layers || []).map((layer, index) => ({ index, id: layer.id, t0: layer.t0, t1: layer.t1, x: layer.x, y: layer.y, scale: layer.s, opacity: layer.op, rotation: layer.r, mask: layer.mask, blend: layer.blend || "source-over", follow: layer.follow || "none", followOffsetX: layer.followOffsetX || 0, followOffsetY: layer.followOffsetY || 0, maskWidth: layer.mk?.w ?? 0.8, maskHeight: layer.mk?.h ?? 0.8, maskThreshold: layer.mk?.th ?? 0.5, maskFeather: layer.mk?.f ?? 0.12, maskAngle: layer.mk?.a ?? 0, maskInverted: !!layer.mk?.inv, chromaKey: !!layer.key?.on, chromaColor: layer.key?.c ?? "#00FF00", chromaTolerance: layer.key?.tol ?? 0.35, native: nativeLayer(layer) }));
    },
    async layerAdd(a) {
      const st = studio();
      if (!st?.layerAdd) throw new Error("Layer editor is not ready");
      const file = await fileOf(String(a.path), String(a.name || "overlay"));
      await st.layerAdd([file]); await Promise.resolve(st.saveNow?.());
      return { ok: true, count: st.layers?.length ?? 0 };
    },
    async layerSelect(a) {
      const st = studio();
      if (!st?.layerSelect) throw new Error("Layer editor is not ready");
      const ok = await st.layerSelect(Number(a.index));
      return { ok: !!ok, selected: Number(a.index) };
    },
    async layerSet(a) {
      const st = studio();
      if (!st?.layerSet) throw new Error("Layer editor is not ready");
      st.layerSet(String(a.key), a.value); await Promise.resolve(st.saveNow?.());
      return { ok: true };
    },
    async layerDelete() {
      const st = studio();
      if (!st?.layerDelete) throw new Error("Layer editor is not ready");
      const ok = st.layerDelete(); await Promise.resolve(st.saveNow?.());
      return { ok };
    },
    async ttsVoices() { return studio()?.ttsVoices || []; },
    async ttsAdd(a) {
      const st = studio();
      if (!st?.addTts) throw new Error("Text-to-speech is not ready");
      return await st.addTts(String(a.text || ""), String(a.voice || ""));
    },
    async ttsClear() { const st = studio(); if (!st?.clearTts) throw new Error("Voice track is not ready"); return { ok: st.clearTts() }; },
    async captions(a) {
      const st = studio();
      if (!st?.setCaptions) throw new Error("Captions are not ready");
      return await st.setCaptions(!!a.enabled, a.language === undefined ? undefined : String(a.language), a.translation === undefined ? undefined : String(a.translation));
    },
    async captionStyle(a) {
      const st = studio();
      if (!st?.setCaptionStyle) throw new Error("Caption styles are not ready");
      return { style: st.setCaptionStyle(String(a.style || "pop")) };
    },
    async shotExtract() {
      const st = studio();
      if (!st?.shotExtract) throw new Error("Audio extraction is not ready");
      return await st.shotExtract();
    },
    async shotReverse() {
      const st = studio();
      if (!st?.shotReverse) throw new Error("Reverse is not ready");
      return { ok: await st.shotReverse(), state: st.state() };
    },
    async shotStyle(a) {
      const st = studio();
      if (!st || !st.edit?.length) throw new Error("There is no selected shot");
      const index = st.segAt(st.now);
      const row = root.querySelectorAll<HTMLTableRowElement>("#edl tr")[index];
      const cell = row?.children[String(a.kind) === "transition" ? 3 : String(a.kind) === "effect" ? 4 : 5];
      const select = cell?.querySelector("select");
      if (!select) throw new Error("This shot style control is not ready");
      select.value = String(a.value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, state: st.state() };
    },
    async part(a) { await studio()?.setPart(Number(a.start)); return { start: studio()?.section.start ?? 0 }; },
    async edit(a) {
      await until(made);
      const st = studio()!;
      const incoming = a.shots as Record<string, unknown>[];
      // Keep Studio-only clip treatment (colour, masks, stabilisation, custom speed curves and user keyframes)
      // when the native editor synchronises its portable shot trims/transitions/effects before export.
      const merged = incoming.map((shot, i) => {
        const current = st.edit[i] as Record<string, unknown> | undefined;
        if (!current) return shot;
        const cs = { ...((current.cs as Record<string, unknown>) || {}), ...((shot.cs as Record<string, unknown>) || {}) };
        return { ...shot, ...(Object.keys(cs).length ? { cs } : {}), uk: shot.uk ?? current.uk, acc: current.acc, ak: current.ak };
      });
      // the export runs as long as the song's part: shots that end before it (a trimmed shot) must not leave black, the last shot holds
      const last = merged[merged.length - 1];
      if (last && Number(last.end) < st.dur) last.end = st.dur;
      const ok = !!st.setEdit(merged);
      if (Array.isArray(a.overlays) && st.setOverlays) st.setOverlays(a.overlays as Array<Record<string, unknown>>);
      return { ok };
    },
    async set(a) {
      const box = String(a.box), gen = studio()!.editGen;
      if (a.attr) { if (!press(box, String(a.attr), String(a.value))) throw new Error("The studio has no " + a.value); }
      else {
        const i = $<HTMLInputElement>(box);
        if (!i) throw new Error("The studio has no " + box);
        if (i.type === "checkbox") i.checked = !!a.value; else i.value = String(a.value);
        i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true }));
      }
      await until(() => studio()!.editGen !== gen, 1500).catch(() => {}); // a new style makes a new Reel (a filter does not)
      return OPS.ready(a);
    },
    /** the test APK: a copy of the engine's state and the Reel the brain makes from it here; the phone's own JS makes it too and compares */
    async brainCheck() {
      const d = (studio() as unknown as { brainDebug: { ES: unknown; HOOKS: unknown } }).brainDebug, copy = copyOfState(d.ES, d.HOOKS);
      return { copy, shots: reelFromCopy(copy).shots };
    },
    /** what Shubix AI planned for this Reel, in the chat's words: its story and a line for each shot; null when it has not edited it */
    async aiPlan() { return (studio() as unknown as { aiPlan?: unknown } | undefined)?.aiPlan ?? null; },
    /** Ask Shubix from the phone's editor: the website's chat; its plan applied -> { answer, applied, state } */
    async chat(a) {
      const st = studio() as unknown as { chatApp?: (t: string) => Promise<{ answer: string; applied: boolean }>; state: () => unknown };
      if (!st.chatApp) throw new Error("Ask Shubix is not ready");
      const r = await st.chatApp(String(a.text || "").slice(0, 300));
      await until(made, 240_000).catch(() => undefined);
      return { ...r, state: st.state() };
    },
    /** the clips' smooth copies (4K / HDR / 60 fps / changing frame rate), saved on the phone for its own preview and
     * export -> [{ name, path, w, h }] (clips that need none are left out) */
    async copies() {
      const list = ((studio() as unknown as { copies?: () => { i: number; name: string; blob: Blob | null; path: string; w: number; h: number }[] }).copies?.() ?? []).filter((c) => c.blob);
      const out: { name: string; path: string; w: number; h: number }[] = [];
      for (const c of list) {
        if (c.path) { out.push({ name: c.name, path: c.path, w: c.w, h: c.h }); continue; }   // made by the phone: already there
        const ext = /webm/.test(c.blob!.type) ? "webm" : "mp4", name = `copy-${c.i}-${c.name.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_").slice(0, 60)}.${ext}`;
        const r = await send(`${files}/out?k=${key}&name=${encodeURIComponent(name)}`, { method: "PUT", body: c.blob });
        if (r.ok) out.push({ name: c.name, path: String((await r.json()).path), w: c.w, h: c.h });
      }
      return out;
    },
    async answer(a) { const b = $({ ok: "cconfok", no: "cconfno" }[String(a.pick)] ?? "cconfx"); b?.click(); return { ok: !!b }; },
    /** The website's Export sheet, with the phone's choices so far -> what the plan and the phone allow ({ res: { 720|1080|4k:
     * { locked, off } }, fps60Locked, watermarkOff }), the size and the file name, My Reels (whether the account has it, and
     * its note), and what in this Reel the plan does not include ({ name, need }) */
    async exportOptions(a) {
      await until(made);
      await sheet(true); pick(a);
      const btn = (box: string, attr: string, v: string) => root.querySelector<HTMLButtonElement>(`#${box} [${attr}="${v}"]`), text = (id: string) => $(id)?.textContent?.trim() ?? "";
      const res = Object.fromEntries(["720", "1080", "4k"].map((r) => { const b = btn("xres", "data-r", r); return [r, { locked: !!b?.classList.contains("crowned"), off: !!b?.disabled }]; }));
      const out = { res, fps60Locked: !!btn("xfps", "data-f", "60")?.classList.contains("crowned"), watermarkOff: !$<HTMLInputElement>("xwm")?.disabled,
        size: text("xsize"), fileName: text("xfname"), myReels: !$("xmyrow")?.hidden, myReelsNote: $("xcloudnote")?.hidden ? "" : text("xcloudnote"), locked: studio()!.exportLocked() };
      await sheet(false);
      return out;
    },
    /** stops a running export (the website's Cancel export) */
    async cancelExport() { $("fexpcancel")?.click(); return { ok: true }; },
    async exportReel(a) {
      await until(made);
      // the creator closed Shubix AI's question: the studio keeps the Reel for Shubix AI (its own words say so)
      if (root.classList.contains("aineed")) throw new Error($("aiaskt")?.textContent || "Your Reel is waiting for Shubix AI");
      // the choices of the website's Export sheet, then its plan check: what the plan does not include is taken out only when
      // the person said so (fixLocked), else the phone is told what it is (LOCKED:[…]) and asks
      await sheet(true); pick(a);
      const locked = studio()!.exportLocked();
      if (locked.length && !a.fixLocked) { await sheet(false); throw new Error("LOCKED:" + JSON.stringify(locked)); }
      if (locked.length) studio()!.exportFix();
      await sheet(false);
      const blob = await studio()!.autoExport(!!a.myReels);
      if (!blob) throw new Error("The Reel could not be made");
      const r = await send(`${files}/out?k=${key}&name=${encodeURIComponent(String(a.name || "reel.mp4"))}`, { method: "PUT", body: blob });
      if (!r.ok) throw new Error("The Reel could not be saved on the phone");
      return { ...(await r.json()), size: blob.size, caption: studio()!.caption() };
    },
  };

  const onTask = (e: Event) => { const d = (e as CustomEvent).detail; if (d.id === "clips" && (d.state === "done" || d.state === "fail")) reading = false; post({ event: "task", ...d }); };
  root.addEventListener("studio-task", onTask);
  const onSpent = () => post({ event: "spent" });
  root.addEventListener("studio-ai-spent", onSpent);
  // the studio's question opens (#cconf shown): the phone asks it
  // every question once, by its number (a question asked while another was still showing, or a box drawn anew, used to
  // stay unasked on the phone: the studio then waited for ever, e.g. Ask Shubix)
  const text = (id: string) => $(id)?.textContent?.trim() ?? "";
  let askedQ = "";
  const askNow = () => {
    const box = $("cconf");
    if (!box || box.hidden || box.dataset.q === askedQ) return;
    askedQ = box.dataset.q ?? "";
    post({ event: "ask", title: text("cconft"), text: text("cconfp"), list: [...(box.querySelectorAll("#cconfl li") ?? [])].map((li) => li.textContent ?? ""), balance: text("cconfbal"), ok: text("cconfok"), no: $("cconfno")?.hidden ? "" : text("cconfno") });
  };
  const asking = new MutationObserver(askNow);
  asking.observe(root, { subtree: true, attributes: true, attributeFilter: ["hidden", "data-q"] });
  (window as unknown as { engine: unknown }).engine = {
    async call(id: number, op: string, args: Record<string, unknown>) {
      try {
        if (!OPS[op]) throw new Error("Unknown engine op: " + op);
        post({ id, ok: true, result: await OPS[op](args || {}) });
      } catch (e) { post({ id, ok: false, error: String((e as Error)?.message ?? e) }); }
    },
  };
  post({ id: 0, ok: true, result: "ready" });
  return () => { root.removeEventListener("studio-task", onTask); root.removeEventListener("studio-ai-spent", onSpent); asking.disconnect(); window.fetch = send; };
}
