/** Fast Studio's Create flow (UI/ design "After Clip Music Reel", phones and computers), on top of the engine's steps:
 *
 * Computers: one page. The header (back, "Music Reel", the four steps Music · Clips · AI Edit · Preview & Export), then
 *   1 Choose Music, 2 Add Your Clips, 3 AI Edit in a column, and the Reel Preview with Generate Reel beside them.
 * Phones: one screen at a time: the intro (the first time), choose music, add clips (Adjust music from there), then
 *   the finished Reel ("Your Reel is ready", the editor's tools in a row, Export).
 * The song and the clips are read behind the page (each clip's card says how it goes). Generate opens the one popup.
 *
 * The engine makes the edit by itself as soon as there is a song and clips; the flow keeps that edit behind the
 * Analysing screen until Generate (computers) or Next (phones) is pressed, then hands the page to the editor views
 * (views.ts). A saved Reel that is opened again and Story → Reel skip the flow; Copy a Reel (/create/copy) first asks for
 * the Reel to copy. Everything here shows,
 * hides or forwards to the engine's own controls (ids from markup.ts); the progress comes from tasks.ts events. */

import type { TaskEvent } from "./tasks";
import { tx } from "./i18n";

type Kind = "music" | "talk" | "photo" | "copy";
type Step = "intro" | "choose" | "adjust" | "clips" | "analyse";

const KINDS: Record<Kind, { title: string; sub: string; intro: string; checks: string[]; icon: string }> = {
  music: { title: "Music Reel", sub: "Turn your clips into a stunning Reel with music, beats and Shubix edits.", intro: "Create a Music Reel", checks: ["Pick a song", "Add your videos or photos", "Shubix edits on the beat", "Preview, make changes and export"], icon: "music" },
  talk: { title: "Talking Reel", sub: "Your talking video, pauses cut, captions added, music under the voice.", intro: "Create a Talking Reel", checks: ["Add your talking video", "Pauses cut, captions added", "Soft music under the voice", "Preview, make changes and export"], icon: "voice" },
  photo: { title: "Photo Reel", sub: "Your photos, moving to the music, cut on the beat.", intro: "Create a Photo Reel", checks: ["Pick a song", "Add your photos", "Shubix moves them on the beat", "Preview, make changes and export"], icon: "image" },
  copy: { title: "Copy a Reel", sub: "Match a Reel you like: its cuts, texts and look on your clips.", intro: "Copy a Reel", checks: ["Pick the Reel to copy (its song comes with it)", "Add your clips", "Shubix copies its cuts and look", "Preview, make changes and export"], icon: "copy" },
};
const ORDER: Record<"music" | "talk", Step[]> = { music: ["intro", "choose", "clips", "analyse"], talk: ["intro", "clips", "analyse"] };
// which engine task moves which line of the AI checklist (data-t in markup.ts)
const LINE_OF: Record<string, string> = { clips: "clips", beats: "beats", ai: "ai" };
// the breadcrumb's name for each step (phones walk them one by one; computers see Music, Clips and Shubix Edit at once)
const STEP_NAME: Record<Step, string> = { intro: "Start", choose: "Music", adjust: "Adjust Music", clips: "Clips", analyse: "Shubix Edit" };
// what the browser keeps for each screen of the flow (history.state.fflow): Back and Forward walk the screens
type Mark = { step: Step; revealed: boolean; tool: string; n: number };
// the engine's work the Reel waits for (the song, the beat check, reading the clips, the AI director): Next (phones) and
// Generate Reel (computers) stay off until all of it is done, so what opens is the finished Reel
const WAIT = new Set(["song", "beats", "clips", "ai"]);

export function initFlow(root: HTMLElement): () => void {
  const ac = new AbortController(), sig = { signal: ac.signal };
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>("#" + id)!;
  const q = new URLSearchParams(location.search);
  // a saved Reel, a Story or a picked template opens in the editor as before
  // (a Reel left in the steps, ?p=…&step=clips: its steps again, the engine fills in what it had)
  let revealed = (q.has("p") && !q.has("step")) || location.pathname === "/create/story";
  // a saved Reel being opened: "Opening your Reel…" from the first paint (the engine takes it away once it is back)
  if (q.has("p")) root.classList.add("opening");
  let step: Step = q.has("p") && (["choose", "adjust", "clips"] as string[]).includes(q.get("step") ?? "") ? (q.get("step") as Step) : "intro";
  let kind: Kind = "music";
  let pct = 0;
  // Copy a Reel: the Reel being copied (its file, for its song) and whether its song is still to come (below)
  let refFile: File | null = null, refName = "", autoSong = false;
  const lines = new Map<string, "now" | "ok">();
  const working = new Set<string>(); // the WAIT tasks running right now
  let wantGen = false, aiLater = false; // Generate pressed: the popup shows what is left, and it goes on by itself
  let lengthTouched = false;
  const phone = () => window.matchMedia("(max-width: 1023px)").matches;
  // how many screens of this flow the browser has before this one (0: the page as it was opened)
  let depth = (history.state as { fflow?: Mark } | null)?.fflow?.n ?? 0;   // (a reload keeps its place in the walk)
  // the phone app's hidden studio (/engine) keeps its own address: a reload there (the phone restarting the page) must
  // open the engine again, never the Create flow or the editor (the app would stop working)
  const inEngine = location.pathname === "/engine";
  const setAddress = (url: string) => { if (!inEngine) history.replaceState(history.state, "", url); };
  // a tool open on the phones' Reel (Edit Options) is a screen of its own too: Back closes it
  let toolMarked = "";
  const mark = (push: boolean) => {
    if (push) depth++;
    const fflow: Mark = { step, revealed, tool: toolMarked, n: depth };
    const st = { ...(history.state ?? {}), fflow };
    if (push) history.pushState(st, "");
    else history.replaceState(st, "");
  };

  const has = (c: string) => root.classList.contains(c);
  const done = (id: string) => $(id).classList.contains("done");
  const made = () => has("made") || !$("s3").classList.contains("locked");
  const chosen = () => has("c1");
  const songOk = () => done("s1") || has("talkmode") || $("s1st").textContent?.startsWith("No song");
  const clipsOk = () => done("s2");
  // Shubix's line under the clips ends in "…" while it works (scoring the clips, the pace, planning the shots, the mixes)
  // Shubix AI still working on the Reel (the studio's own state; its status line can end in "…" when it is only cut short)
  const aiWorking = () => { const w = (root as unknown as { __studio?: { work?: { ai?: boolean; dir?: boolean; pace?: boolean; aiWait?: boolean } } }).__studio?.work; return !!w && (!!w.ai || !!w.dir || !!w.pace || !!w.aiWait); };   // (aiWait: agreed to, its plan not here yet, also between its steps)
  type Live = { upsell?: () => Promise<string>; changeGate?: () => Promise<string>; keepOldReel?: () => void; saveNow?: () => Promise<string>; askNotDone?: () => Promise<boolean>; cancelled?: () => { song: boolean; clips: boolean }; guard?: (on: boolean) => void };
  const live = () => (root as unknown as { __studio?: Live }).__studio;
  const stopped = () => live()?.cancelled?.() ?? { song: false, clips: false };
  let aiRunNo = 0;   // the wait for the Reel that the popup's Cancel ended
  const shubixBusy = () => { const a = $("aistat"); return !a.hidden && /…$/.test(a.textContent ?? ""); };
  const order = () => ORDER[has("talkmode") ? "talk" : "music"];

  // the kind in the address (/create/music|talking|photo|copy): the flow is open from the first paint, before the engine
  // has picked that kind (it does a moment later, once it has started)
  const urlKind = (): Kind | null => ({ music: "music", talking: "talk", photo: "photo", copy: "copy" } as Record<string, Kind>)[location.pathname.split("/")[2] ?? ""] ?? null;
  const readKind = (): Kind => {
    if (!chosen() && urlKind()) return urlKind()!;
    // Copy a Reel stays Copy a Reel once a song is chosen, also before the Reel to copy is picked
    if (urlKind() === "copy" && !has("talkmode") && !has("photomode")) return "copy";
    if (has("talkmode")) return "talk";
    if ($("copycard").getAttribute("aria-pressed") === "true") return "copy";
    if (has("photomode")) return "photo";
    return "music";
  };

  // the flow's places: the clips' own sound (from the Music panel) under the clips; the format in the preview card
  const pvbox = root.querySelector<HTMLElement>(".pvbox")!;
  const homes = { snd: $("clipsnd").parentElement!, sndNext: $("clipsnd").nextElementSibling, asp: $("aspect").closest(".row")!, pv: pvbox.parentElement!, pvNext: pvbox.nextElementSibling };
  const place = (on: boolean) => {
    if (on) {
      if ($("clipsnd").parentElement !== $("fsndslot")) $("fsndslot").append($("clipsnd"));
      if (!phone() && $("aspect").parentElement !== $("faspslot")) $("faspslot").append($("aspect"));
      if (phone() && $("aspect").parentElement === $("faspslot")) homes.asp.append($("aspect"));
      // the made Reel plays in the preview card (the engine's own canvas and play button, moved here until Generate)
      const inCard = !phone() && made();
      if (inCard && pvbox.parentElement !== $("fprevbox")) $("fprevbox").append(pvbox);
      if (!inCard && pvbox.parentElement === $("fprevbox")) homes.pv.insertBefore(pvbox, homes.pvNext);
    } else {
      if (pvbox.parentElement === $("fprevbox")) homes.pv.insertBefore(pvbox, homes.pvNext);
      if ($("clipsnd").parentElement === $("fsndslot")) homes.snd.insertBefore($("clipsnd"), homes.sndNext);
      if ($("aspect").parentElement === $("faspslot")) homes.asp.append($("aspect"));
    }
  };

  // every write only when it changes something: a write is a DOM mutation even with the same value, and the flow (and
  // views.ts) watch the DOM, so an unchanged write would wake them again and again (a busy page)
  const setText = (el: Element, t: string) => { t = tx(t); if (el.textContent !== t) el.textContent = t; }; // the admin's wording (i18n.ts)
  const setAttr = (el: Element, k: string, v: string) => { if (el.getAttribute(k) !== v) el.setAttribute(k, v); };
  const setFlag = (el: HTMLElement & { disabled?: boolean }, k: "hidden" | "disabled", v: boolean) => { if (el[k] !== v) el[k] = v; };
  const setClass = (el: Element, c: string, on: boolean) => { if (el.classList.contains(c) !== on) el.classList.toggle(c, on); };
  // the steps in the flow's head: at = the one you are on
  const steps = (at: number) => root.querySelectorAll<HTMLElement>("#fsteps li").forEach((li) => { const f = +li.dataset.f!; setAttr(li, "data-s", f === at ? "on" : f < at ? "ok" : "no"); setText(li.querySelector("i")!, f < at ? "✓" : String(f)); });
  const setData = (el: HTMLElement, k: string, v: string) => { if (el.dataset[k] !== v) el.dataset[k] = v; };
  /** Each kind starts as it is meant: a Music Reel and a Photo Reel mute the clips' own sound under the song, a Talking
   * Reel keeps only the voices (Videos or Photos follow the kind: photomode). Only changed when it differs. */
  const defaults = (k: Kind) => {
    const want = k === "talk" ? "voices" : "mute";
    const b = root.querySelector<HTMLButtonElement>(`#csnd [data-c="${want}"]`);
    if (b && b.getAttribute("aria-pressed") !== "true") b.click();
  };
  // Shubix Edit's lines say what Shubix has done: nothing until Generate has started it
  let aiGo = false;
  const paintAi = () => {
    const make = made() && !aiWorking();
    for (const li of root.querySelectorAll<HTMLElement>(".faiList li[data-t]")) { // (not the export's list: its own progress ticks it)
      const t = li.dataset.t!;
      // the last line (the edit itself) runs once the song and clips are in; every line is done once the Reel is made
      const st = !aiGo ? "" : make ? "ok" : t === "make" ? "now" : (lines.get(t) ?? "");
      setClass(li, "now", st === "now");
      setClass(li, "ok", st === "ok");
    }
    const all = [...root.querySelectorAll(".fanList li:not(#fexplist li)")], ok = all.filter((l) => l.classList.contains("ok")).length;
    const p = make ? 100 : Math.max(pct, Math.round((ok / all.length) * 100));
    setText($("fanpct"), p + "%");
    const off = String(326.7 * (1 - p / 100));
    if ($("fanring").style.strokeDashoffset !== off) $("fanring").style.strokeDashoffset = off;
  };

  // the breadcrumb (phones and computers): Home › the kind of Reel › the screen (› the open tool on phones)
  let crumbKey = "";
  const crumbs = (on: boolean) => {
    const tool = root.dataset.tool ?? "";
    const toolName = tool && has("fpost") ? root.querySelector(`.tool[data-tool="${tool}"] span`)?.textContent ?? "" : "";
    const flowKind = chosen() || !!urlKind();
    const k = flowKind ? KINDS[readKind()].title : "";
    const cur = !songOk() ? "choose" : !clipsOk() ? "clips" : "analyse";
    const items: [string, string][] = [["Home", "home"]];   // [name, what it opens]
    if (!flowKind && q.has("p")) items.push(["My Reels", "reels"]);
    if (k) items.push([k, on ? "start" : "flow"]);
    const here = step === "clips" && has("photomode") ? "Photos" : STEP_NAME[phone() ? step : (cur as Step)];
    if (on) items.push([readKind() === "copy" && !has("pickown") && (here === "Music" || here === "Start") ? "Reel to copy" : here, ""]);
    else if (revealed || has("made")) items.push(["Your Reel", toolName ? "reel" : ""]);
    if (!on && toolName) items.push([toolName, ""]);
    const key = items.map((x) => x.join(":")).join("|");
    if (key === crumbKey) return;
    crumbKey = key;
    const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    $("fcrumbs").innerHTML = "<ol>" + items.map(([t, to], i) => {
      const last = i === items.length - 1;
      if (last) return `<li><span aria-current="page">${esc(t)}</span></li>`;
      if (to === "home") return `<li><a href="/">${esc(t)}</a></li>`;
      if (to === "reels") return `<li><a href="/reels">${esc(t)}</a></li>`;
      return `<li><button type="button" data-crumb="${to}">${esc(t)}</button></li>`;
    }).join("") + "</ol>";
  };

  /* Computers: one section open at a time. Music first, Clips minimised; once the song and its beat check are done, Music
   * minimises with a green tick (its song's name on it) and the page goes on to Clips. A section's head opens it again. */
  let sectionsOn = false, openSec: "s1" | "s2" | "fai" | null = null, songWas = false, clipsWas = false, songTimer: ReturnType<typeof setTimeout> | undefined, clipsTimer: ReturnType<typeof setTimeout> | undefined;
  const clipsDoneNow = () => clipsOk() && !stopped().clips && !working.has("clips");
  const openSection = (id: "s1" | "s2" | "fai") => { openSec = id; apply(); setTimeout(() => $(id).scrollIntoView({ behavior: "smooth", block: "start" }), 60); };
  const songDoneNow = () => !!songOk() && !stopped().song && !working.has("song") && !working.has("beats") && !working.has("refsong");
  const toClips = () => openSection("s2");
  const sections = (on: boolean) => {
    const desk = on && !phone(), songDone = songDoneNow();
    // the Reel opens: the editor hides these sections again (it keeps them folded; its own tools can still open one)
    if (sectionsOn && !desk && revealed) for (const id of ["s1", "s2"]) { setClass($(id), "folded", true); setAttr($(id).querySelector(".sh")!, "aria-expanded", "false"); }
    sectionsOn = desk;
    if (desk && openSec === null) { openSec = songDone ? "s2" : "s1"; songWas = songDone; }
    if (desk && songDone && !songWas) { clearTimeout(songTimer); songTimer = setTimeout(() => { if (songDoneNow() && !songWas) { songWas = true; toClips(); } }, 700); }   // (the beat check may start right after the song)
    if (!songDone) { clearTimeout(songTimer); if (desk && songWas) openSec = "s1"; songWas = false; }
    // the clips done: they minimise too and the page goes on to Shubix Edit
    const clipsDone = clipsDoneNow();
    if (desk && clipsDone && !clipsWas) { clearTimeout(clipsTimer); clipsTimer = setTimeout(() => { if (clipsDoneNow() && !clipsWas) { clipsWas = true; if (songDoneNow()) openSection("fai"); else apply(); } }, 700); }
    if (!clipsDone) { clearTimeout(clipsTimer); if (desk && clipsWas) openSec = songDone ? "s2" : "s1"; clipsWas = false; }
    for (const id of ["s1", "s2"] as const) {
      const s = $(id), head = s.querySelector<HTMLElement>(".sh")!, num = head.firstElementChild as HTMLElement, fold = desk && openSec !== id, tick = desk && done(id) && (id !== "s1" || songDone);
      setClass(s, "ffold", fold);
      if (desk) { setClass(s, "folded", false); setAttr(head, "aria-expanded", String(!fold)); }
      setText(num, tick ? "✓" : id === "s1" ? "1" : "2");
      setClass(num, "bg-success!", tick); setClass(num, "text-white", tick);
      if (fold && tick && id === "s1") setText(head.querySelector<HTMLElement>(".fsh")!, ($("mname").textContent ?? "").replace(/\.[^.]+$/, ""));
    }
  };
  const apply = () => {
    live()?.guard?.(!revealed);   // the popup's Cancel, while the Reel is being made
    const on = (chosen() || !!urlKind()) && !revealed && !has("autoing");
    setClass(root, "fopen", on);
    setFlag($("fhead"), "hidden", !on);
    // phones, once the Reel is made: "Your Reel is Ready!" (the editor under the flow's head, step 4), and its
    // tools as "Edit Options" (screens 6 and 7 of the design)
    const post = !on && revealed && made() && !has("autoing") && phone();
    setClass(root, "fpost", post);
    if (post) {
      setText($("fptitle"), root.dataset.tool ? "Edit Options" : "");
      steps(4);
    }
    crumbs(on);
    if (!on) { sections(false); setFlag($("fintro"), "hidden", true); setFlag($("s1"), "hidden", false); setFlag($("s2"), "hidden", false); if (root.hasAttribute("data-fstep")) root.removeAttribute("data-fstep"); place(false); return; }
    const k = readKind();
    if (k !== kind || !$("ftitle").dataset.k) {
      kind = k;
      const K = KINDS[k];
      $("ftitle").dataset.k = k;
      setText($("ftitle"), K.title);
      setText($("fsub"), K.sub);
      setText($("fintroh"), K.intro);
      setText($("fintrop"), K.sub);
      root.querySelectorAll("#fintrol li").forEach((li, i) => { const svg = li.querySelector("svg"); li.textContent = K.checks[i] ?? ""; if (svg) li.prepend(svg); });
      $("fintroic").innerHTML = root.querySelector(`#kind [data-k="${k === "talk" ? "talk" : "music"}"] svg`)?.outerHTML ?? "";
      if (k === "photo") $("fintroic").innerHTML = $("photokind").querySelector("svg")!.outerHTML;
      if (k === "copy") $("fintroic").innerHTML = $("copycard").querySelector("svg")!.outerHTML;
      setText($("fgot"), k === "copy" ? "Pick the Reel to copy" : "Let's Start");
      if (!order().includes(step) && step !== "adjust") step = "intro";
      // the intro the first time only (Copy a Reel: its first button picks the Reel)
      if (step === "intro" && k !== "copy") { try { if (localStorage.getItem("create-intro-seen")) step = order()[1]; else localStorage.setItem("create-intro-seen", "1"); } catch { /* private mode: the intro */ } }
      defaults(k);
      // each kind at its own address (/create/music, /create/talking, /create/photo); the same page, no reload
      const slug = { music: "music", talk: "talking", photo: "photo", copy: "copy" }[k];
      if (slug && location.pathname !== `/create/${slug}`) setAddress(`/create/${slug}${location.search}${location.hash}`);
    }
    setData(root, "fstep", step);
    setFlag($("fintro"), "hidden", step !== "intro");
    // the cards: all on computers, one screen at a time on phones
    setFlag($("s1"), "hidden", phone() && step !== "choose" && step !== "adjust");
    setFlag($("s2"), "hidden", phone() && step !== "clips");
    setData(root, "fkind", kind);
    // the step in the address (/create/music?step=clips): each screen of the flow has its own; a made Reel moves to /create/edit?p=…
    // (back in the steps from a made Reel, whose address is the editor's: the steps' own address again, /create/music?step=…)
    if (!revealed) {
      const u = new URL(location.href), want = step === "intro" ? "" : step, slug = { music: "music", talk: "talking", photo: "photo", copy: "copy" }[k];
      let moved = false;
      if (slug && /^\/(editor|create\/edit)$/.test(u.pathname)) { u.pathname = `/create/${slug}`; u.searchParams.delete("p"); u.searchParams.delete("session"); moved = true; }
      if ((u.searchParams.get("step") ?? "") !== want) { if (want) u.searchParams.set("step", want); else u.searchParams.delete("step"); moved = true; }
      if (moved) setAddress(u.pathname + u.search + u.hash);
    }
    setClass(root, "flive", true); for (const id of ["fhead", "fintro"]) setClass($(id), "invisible", false); // the kind's own words are in: the flow can be seen
    // the music card's title: choosing on computers and the phones' first screen, adjusting on the second
    const adj = phone() && step === "adjust", copy = kind === "copy";
    // Copy a Reel: the song is the copied Reel's ("Different song?" in the Reel to copy box opens the picker: .pickown)
    const own = has("pickown");
    setText($("s1").querySelector("h2")!, adj ? "Adjust Music" : copy && !own ? "Music" : "Choose Music");
    setText($("s1").querySelector(".fsh")!, adj ? "Trim or select the best part of the song" : copy && !own ? "The song of the Reel you copy" : "Pick a song or sound for your Reel");
    setFlag($("frefother"), "hidden", own);
    setText($("fsteps").querySelector('li[data-f="1"] span')!, copy && !own ? "Reel" : "Music");
    // the phones' head names the screen (the intro and Analysing have their own big titles)
    // Adjust Music (phones): the chosen song in a row at the top
    if (adj) { setText($("fsongn"), ($("mname").textContent ?? "").replace(/\.[^.]+$/, "")); setText($("fsongd"), "Song · " + ($("mdur").textContent ?? "")); }
    setText($("fptitle"), { intro: "", choose: copy && !own ? "Music" : "Choose Music", adjust: "Adjust Music", clips: has("photomode") ? "Add Your Photos" : "Add Your Clips", analyse: "" }[step]);
    place(true);
    sections(on);
    // the header's steps: Music · Clips · AI Edit · Preview & Export
    const cur = !songDoneNow() ? 1 : !clipsDoneNow() ? 2 : 3;
    const mob = { intro: 1, choose: 1, adjust: 1, clips: 2, analyse: 3 }[step];
    const at = phone() ? mob : cur;
    steps(at);
    // clips: Videos / Photos
    root.querySelectorAll<HTMLButtonElement>("#ftabs button").forEach((b) => setAttr(b, "aria-pressed", String((b.dataset.ft === "photos") === has("photomode"))));
    setFlag($("ftabs"), "hidden", has("talkmode") || kind === "copy");
    // Next on the clips step, Generate in the preview card: on once the clips are in and the Reel is made, with nothing
    // still being read or decided (a spinner in the button meanwhile)
    const ready = clipsOk() && !!songOk();
    // nothing can be made from these clips (a talking Reel without a voice): no endless spinner, the reason instead
    const stop = !made() && working.size === 0 ? root.dataset.nomake ?? "" : "";
    // Copy a Reel: the copied Reel's song may still be coming while the clips are in (Next waits for it, spinning)
    const songComing = working.has("refsong") || working.has("song");
    const busy = (ready || (clipsOk() && songComing)) && !stop && (working.size > 0 || shubixBusy() || !made());
    // nothing goes forward while the song or the clips are being worked on, or without both. After a Cancel it only offers to continue
    const paused = (stopped().song || songOk()) && (stopped().clips || clipsOk()) && (stopped().song || stopped().clips);
    // every button forward says what it waits for while it is off (phones: Next on each screen; computers: Generate)
    const reading = !stopped().clips && (working.has("clips") || (!!$("qinfo").textContent && !clipsOk()));
    // on as soon as the clips are chosen: what is still being read is shown in the popup after the press
    const goes = (clipsOk() || reading) && (!!songOk() || songComing);
    setFlag($<HTMLButtonElement>("fclipsnext"), "disabled", (!clipsOk() && !stopped().clips && !reading) || !!stop || wantGen);
    const missing = stopped().clips ? "" : !clipsOk() ? (reading ? "Reading your clips…" : has("photomode") ? "Add your photos to continue" : "Add your clips to continue")
      : !songOk() && !songComing ? "Choose a song first" : "";
    setText($("fclipsnt"), stop || (goes ? "Make Reel" : missing || "Make Reel"));
    // Music (phones): Next only with a song ready (or "use my clips' own sound"), a spinner while it is read
    const songBusy = working.has("song") || working.has("refsong");   // (the beat check is waited for at the clips)
    for (const [b, t] of [["fchnext", "fchnt"], ["fadjnext", "fadjnt"]] as const) {
      setFlag($<HTMLButtonElement>(b), "disabled", !songOk() && !stopped().song && !songBusy);
      setText($(t), !songOk() && !stopped().song && !songBusy ? "Choose a song to continue" : b === "fadjnext" ? "Done" : "Next");
    }
    setFlag($("fadjust"), "hidden", has("talkmode") || (!songOk() && !songBusy));
    setFlag($<HTMLButtonElement>("fgen"), "disabled", (!ready && !paused && !goes) || wantGen);
    setAttr($("fclipsnext"), "aria-busy", String(wantGen));
    setAttr($("fgen"), "aria-busy", String(wantGen));
    setText($("fgent"), paused ? "Continue analysis" : wantGen ? "Making your Reel…" : ready || goes ? "Generate Reel" : stopped().song ? missing || "Generate Reel" : (!songOk() && !songComing && (kind !== "copy" || has("pickown")) ? "Choose a song first" : missing || "Generate Reel"));
    const aiDone = aiGo && made() && !aiWorking();
    setText($("freadyt"), aiDone ? "Your Reel is ready!" : aiGo ? "Shubix is editing your Reel…" : "Ready to create your Reel!");
    setText($("freadys"), aiDone ? "Opening your Reel…" : aiGo ? "Every clip, every beat: it takes a moment." : ready ? "Press Generate Reel to start Shubix." : copy && !refName && !songOk() ? "Pick the Reel to copy, then add your clips."
      : copy && songComing ? "Taking the song from the Reel you copy…" : !songOk() ? "Choose a song, then add your clips." : "Add your clips, then press Generate.");
    setText($("fprevnote"), aiDone ? "Your Reel is ready" : "Your Reel appears here");
    setClass($("fprevbox"), "ready", made());
    paintAi();
    // the phones' analysing screen: the Reel opens once it is made
    if (step === "analyse" && made() && !aiWorking()) { revealed = true; mark(false); setTimeout(apply, 350); }   // Back from the Reel: the clips
    // Generate was pressed while the song or clips were being read: on by itself when they are done; a Cancel ends the wait
    if (wantGen) {
      if (stopped().song || stopped().clips || !!stop || (!reading && !songComing && !goes)) wantGen = false;
      else if (ready && !busy && working.size === 0 && !aiLater) { aiLater = true; setTimeout(() => { aiLater = false; wantGen = false; const g = $<HTMLButtonElement>("fgen"); g.disabled = false; g.click(); }, 0); }
    }
    // no popup until Generate: the work goes on behind the page
    const quiet = !revealed && !aiGo && !wantGen && !inEngine ? "1" : "";
    if ((root.dataset.fquiet ?? "") !== quiet) { root.dataset.fquiet = quiet; root.dispatchEvent(new Event("studio-quiet")); }
  };

  const go = (s: Step, push = true) => {
    const moved = s !== step || revealed;
    step = s;
    if (revealed) revealed = false;
    if (moved) mark(push);
    apply();
    if (phone()) window.scrollTo({ top: 0, behavior: "smooth" });   // (computers: all on one page, the page stays where it is)
  };
  const next = () => {
    const o = order(), i = o.indexOf(step);
    if ((step === "choose" || step === "adjust") && stopped().song) { void live()?.askNotDone?.(); return; }
    const songWay = working.has("song") || working.has("refsong");
    if ((step === "choose" || step === "adjust") && !songOk() && !songWay) return;   // (its Next is off: a click that slipped through)
    if ((step === "choose" || step === "adjust") && !phone()) return toClips();   // computers: all on one page
    if (step === "adjust") return go("clips");
    if (step === "clips" && !songOk() && !songWay) { if (kind === "copy") root.classList.add("pickown"); return go("choose"); } // no song yet (Copy a Reel: its Reel had none)
    if (step === "clips") { $<HTMLButtonElement>("fgen").disabled = false; $("fgen").click(); return; }   // as Generate: Shubix AI's question first
    if (i >= 0 && i < o.length - 1) go(o[i + 1]);
  };
  const closeTool = () => root.querySelector<HTMLButtonElement>(`.tool[data-tool="${root.dataset.tool}"]`)?.click();
  const back = () => {
    if (has("fpost") && root.dataset.tool && !toolMarked) return closeTool(); // Edit Options → back to the Reel
    if (has("fpost") && has("editing") && !root.dataset.tool) $("feditdone").click(); // the timeline: one Back leaves it and goes on to the clips (not first to the Reel's review)
    if (depth > 0) { history.back(); return; } // the screen before, as the browser's own Back does
    // opened part way (no screen before it in this visit): the screen before takes this entry's place. A new entry here would
    // be "the screen before" for the next Back, and Back would go round between two screens
    if (has("fpost") && revealed) return go("clips", false); // the Reel → back to the clips
    const o = order(), i = o.indexOf(step);
    if (phone() && i > 0) return go(o[i - 1], false);
    if (history.length > 1) history.back();
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- plain DOM code, leaving the studio is a full load
    else location.href = "/";
  };

  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    // Copy a Reel: its first button picks the Reel to copy (the phone's file picker opens from this tap); the song is next
    if (t.closest("[data-fnext]") && step === "intro" && kind === "copy" && !refName) { e.preventDefault(); pickRef(); return; }
    const nextBtn = t.closest<HTMLElement>("[data-fnext]");
    if (nextBtn && !phone() && nextBtn.closest("#s1")) {   // computers: Music's Next goes on to Clips, where it is on this page
      e.preventDefault();
      if (stopped().song) void live()?.askNotDone?.(); else if (songOk() || working.has("song") || working.has("refsong")) toClips();
      return;
    }
    if (nextBtn && !phone() && nextBtn.closest("#s2")) { e.preventDefault(); if (!songOk() && !stopped().song && !working.has("song") && !working.has("refsong")) openSection("s1"); else { $<HTMLButtonElement>("fgen").disabled = false; $("fgen").click(); } return; }
    if (nextBtn) { e.preventDefault(); next(); return; }
    if (t.closest("#frefpick")) { pickRef(); return; }
    if (t.closest("#frefsong")) { refSong(); return; }
    // a different song: the Choose Music panel opens (phones: its screen), the copied Reel's song is not put on
    if (t.closest("#frefother")) { autoSong = false; working.delete("refsong"); root.classList.add("pickown"); if (phone()) go("choose"); else $("s1").scrollIntoView({ behavior: "smooth", block: "start" }); apply(); return; }
    if (t.closest("#fback")) { back(); return; }
    const cr = t.closest<HTMLElement>("[data-crumb]");
    if (cr) {
      const to = cr.dataset.crumb;
      if (to === "reel") closeTool();
      else if (to === "start" || to === "flow") go(to === "flow" && clipsOk() ? "clips" : order()[0]);
      return;
    }
    // computers: a step at the top opens its section (one that is done, or the one now)
    const stepLi = t.closest<HTMLElement>("#fsteps li");
    if (stepLi && !phone() && !revealed && stepLi.dataset.s !== "no") { const to = ({ 1: "s1", 2: "s2", 3: "fai" } as const)[+stepLi.dataset.f! as 1 | 2 | 3]; if (to) openSection(to); return; }
    const secHead = t.closest<HTMLElement>("#s1 > .sh, #s2 > .sh");   // computers: a section's head opens that section
    if (secHead && root.classList.contains("fopen") && !phone()) { openSec = secHead.parentElement!.id === "s1" ? "s1" : "s2"; apply(); return; }
    if (t.closest("#fadd")) { $("addv").click(); return; } // the "+" tile at the end of the clips
    if (t.closest("#fapply")) { closeTool(); return; } // Edit Options: Apply (every change is already in the Reel)
    const fd = t.closest<HTMLElement>("[data-fd]");
    if (fd) { done10(fd.dataset.fd!); return; }
    if (t.closest("#fskip")) { go(order()[1]); return; }
    if (t.closest("#fadjust")) { go("adjust"); return; }
    if (t.closest("#slen") && e.isTrusted) lengthTouched = true;
    if (t.closest("#fgen")) {
      // still being read: the one popup shows it now, and this goes on by itself when it is done
      if (!stopped().song && !stopped().clips && (working.size > 0 || shubixBusy() || !made())) { wantGen = true; apply(); return; }
      // Free: first, once per Reel, why Shubix AI is worth it (Upgrade, Create basic Reel, or ✕ to stay here)
      const st = live(), run = ++aiRunNo;
      void (async () => {
        if (await st?.askNotDone?.()) return;   // after a Cancel: Proceed reads it again, then Next
        const change = st?.changeGate ? await st.changeGate() : "go";   // changed since the Reel was made: a new Reel, or the old one
        if (change === "stay") return;
        if (change === "old") return st?.keepOldReel?.();
        const r = change === "same" ? "skip" : st?.upsell ? await st.upsell() : "skip";   // (nothing changed: the same Reel, no new credits)
        if (r === "close" && change === "new") return st?.keepOldReel?.();
        if (r === "upgrade" || r === "close") return;
        aiGo = true; apply();
        // the popup shows the work on every screen size; the Reel opens once Shubix is done
        await new Promise((ok) => setTimeout(ok, 400)); apply();
        for (let t = 0; run === aiRunNo && (aiWorking() || !made()) && t < 600; t++) { await new Promise((ok) => setTimeout(ok, 300)); apply(); }   // the AI's Reel, not the first one (3 min at most)
        if (run === aiRunNo && made() && phone()) {   // phones: the finished Reel, with its timeline (also when it is opened again after Back)
          revealed = true; mark(true); apply(); window.scrollTo({ top: 0 });
          requestAnimationFrame(() => { if (!has("editing")) $<HTMLButtonElement>("fedit").click(); void st?.saveNow?.(); });
          return;
        }
        if (run === aiRunNo && made()) {
          revealed = true; mark(true); apply(); window.scrollTo({ top: 0 }); // the editor from its top: the breadcrumb, the Reel's name and Export
          setAddress("/editor?session=1"); // show this live Reel at /editor without reloading or saving it first
          requestAnimationFrame(() => {
            $<HTMLButtonElement>("fedit").click(); // open the real timeline editor; playback stays attached to this Reel
            void st?.saveNow?.(); // persist only after the live editor is open
          });
        }
      })();
      return;
    }
    const ft = t.closest<HTMLButtonElement>("#ftabs button");
    if (ft) {
      const photos = ft.dataset.ft === "photos";
      if (photos !== has("photomode")) (photos ? $("photokind") : root.querySelector<HTMLButtonElement>('#kind [data-k="music"]'))?.click();
      return;
    }
  }, { capture: true, ...sig });

  // screens 9 and 10 (phones): Exporting, then Reel Exported with the video, Share / Save / Download and the caption
  const capHome = { box: $("postcap").parentElement!, next: $("postcap").nextElementSibling };
  const exporting = (p: number) => {
    const pc = Math.round(Math.max(0, Math.min(1, p)) * 100);
    setText($("fexppct"), pc + "%");
    $("fexpring").style.strokeDashoffset = String(326.7 * (1 - pc / 100));
    root.querySelectorAll<HTMLElement>("#fexplist li").forEach((li) => { const at = +li.dataset.at!; setClass(li, "ok", p >= at); setClass(li, "now", p < at && p >= at - 0.35); });
  };
  const showDone = (title?: string) => {
    const v = $<HTMLVideoElement>("fdvideo"), url = $<HTMLAnchorElement>("dlvid").href;
    if (url && v.src !== url) v.src = url;
    setText($("fdsize"), /([\d.]+ ?MB)/.exec(title ?? "")?.[1] ? `Size: ${/([\d.]+ ?MB)/.exec(title ?? "")![1]}` : "");
    if (!$("postcap").hidden) $("fdcap").append($("postcap"));
    $("fdone").hidden = false;
  };
  const done10 = (what: string) => {
    const share = $<HTMLButtonElement>("savevid"), dl = $<HTMLAnchorElement>("dlvid");
    if (what === "close") {
      $("fdone").hidden = true;
      $<HTMLVideoElement>("fdvideo").pause();
      if ($("postcap").parentElement === $("fdcap")) capHome.box.insertBefore($("postcap"), capHome.next);
    } else if (what === "download" || !share.onclick) dl.click(); // no share sheet here (a computer): the file is saved
    else share.click(); // the phone's share sheet: Instagram, WhatsApp, "Save Video" to Photos
  };
  root.addEventListener("studio-task", (e) => {
    const d = (e as CustomEvent<TaskEvent>).detail;
    if (d.id !== "export" || !phone()) return;
    if (d.state === "start") { $("fdone").hidden = true; exporting(0); $("fexp").hidden = false; setText($("fexpcancel"), "Cancel export"); }
    else if (d.state === "progress") exporting(d.p ?? 0);
    else { $("fexp").hidden = true; if (d.state === "done") showDone(d.title); }
  }, sig);

  /* ---- Copy a Reel (/create/copy): the Reel to copy is picked first, straight from the page (before, it was only in the
   * finished Reel's editing modes). Picking it presses the studio's own Copy a Reel (#copycard -> the "Copy a Reel" mode
   * -> #reffile, read by the engine); its file is kept here for its song. Once the Reel is read (not at the same time:
   * one heavy job at a time on a phone), its own song becomes the Reel's song, unless one was chosen already; "Use its
   * song" brings it back after another song. ---- */
  const pickRef = () => {
    if (refName) { $("refchange").click(); return; }   // a Reel is already copied: Change Reel
    $("copycard").click();
  };
  const refSong = () => {
    if (!refFile) return;
    root.classList.remove("pickown");
    const dt = new DataTransfer(); dt.items.add(refFile);
    const mf = $<HTMLInputElement>("mfile"); mf.files = dt.files; mf.dispatchEvent(new Event("change", { bubbles: true }));
  };
  // captured on the way down, before the engine reads the file and empties the input
  root.addEventListener("change", (e) => {
    const inp = e.target as HTMLInputElement;
    if (inp.id !== "reffile" || !inp.files?.[0]) return;
    refFile = inp.files[0]; refName = refFile.name;
    setText($("frefpick"), "Change Reel");
    setFlag($("frefsong"), "hidden", false);
    // its song comes with it: no Choose Music screen (phones go straight to the clips; Music stays reachable to change
    // it). Next / Generate wait for that song like for any song (refsong, then the engine's song task)
    if (!done("s1")) { autoSong = true; working.add("refsong"); apply(); }
    if (step === "intro" || step === "choose") go("clips");
  }, { capture: true, ...sig });
  // what the engine says about the Reel being read ("Reading the Reel: cuts 40%", then what it found)
  const refMo = new MutationObserver(() => {
    const t = ($("refinfo").textContent ?? "").trim(); if (!t) return;
    setText($("frefst"), t);
    if (!autoSong || /^Reading/.test(t)) return;
    autoSong = false;
    if (!/could not read/i.test(t) && !done("s1") && !$("mpick").classList.contains("busy")) refSong();   // the engine's song task takes over
    working.delete("refsong"); apply();
  });
  refMo.observe($("refinfo"), { childList: true, characterData: true, subtree: true });

  // the popup's Cancel during Shubix AI: back to the clips, nothing opens
  root.addEventListener("studio-cancelled", () => { if (step === "adjust" && !done("s1")) go("choose"); else apply(); }, sig);
  root.addEventListener("studio-ai-cancel", () => { aiRunNo++; aiGo = false; if (step === "analyse") go("clips"); else apply(); }, sig);
  // a song that is ready moves the phones on to adjusting it
  let wasSong = done("s1");
  // the engine's progress (reading the clips, the beats, the AI) fills the checklist and the ring
  root.addEventListener("studio-task", (e) => {
    const d = (e as CustomEvent<TaskEvent>).detail, line = LINE_OF[d.id];
    // Copy a Reel whose Reel has no sound we can read: the Music card opens, to choose a song
    if (d.id === "song" && d.state === "fail" && kind === "copy") root.classList.add("pickown");
    // a song on its way: the clips can be added now
    if (d.id === "song" && d.state === "start") { $("s2").classList.remove("locked"); if (step === "choose" && phone()) go("clips"); }
    // Shubix is thinking (planning, re-planning): the preview shows a loader, not the first version made without it
    if (d.id === "ai") setClass(root, "aithink", d.state === "start" || d.state === "progress");
    if (WAIT.has(d.id)) {
      if (d.state === "start" || d.state === "progress") working.add(d.id);
      else working.delete(d.id); // done, failed (the Reel goes on without it) or cleared
      apply();
    }
    if (line) lines.set(line, d.state === "done" ? "ok" : d.state === "fail" || d.state === "clear" ? lines.get(line) ?? "ok" : "now");
    if (d.id === "clips" && d.p !== null) pct = Math.max(pct, Math.round(d.p * 60));
    if (d.id === "clips" && d.title) { setText($("fant"), d.state === "done" ? "Clips read" : "Reading your clips…"); setText($("fand"), d.title); }
    paintAi();
  }, sig);

  // the browser's Back / Forward between the flow's screens: Next.js keeps the page, the flow shows the screen kept
  // not enough clips for the Reel's length: the music page, to shorten it
  root.addEventListener("studio-goto", () => { if (phone()) go("adjust"); else $("s1").scrollIntoView({ behavior: "smooth", block: "start" }); }, sig);
  // the phone reloaded the page and the studio put the song and clips back: their screen
  root.addEventListener("studio-restored", () => go(order().includes("clips") ? "clips" : order()[0]), sig);
  window.addEventListener("popstate", (e) => {
    const f = (e.state as { fflow?: Mark } | null)?.fflow;
    if (!f) return;
    depth = f.n;
    const screen = f.step !== step || f.revealed !== revealed;
    step = f.step;
    revealed = f.revealed;
    toolMarked = f.tool;
    if (root.dataset.tool && root.dataset.tool !== f.tool) closeTool();
    if (f.tool && root.dataset.tool !== f.tool) root.querySelector<HTMLButtonElement>(`.tool[data-tool="${f.tool}"]`)?.click(); // Forward into a tool
    apply();
    if (screen) window.scrollTo({ top: 0 });
  }, sig);
  // a tool opened on the phones' Reel gets its own entry; closed with its own buttons, that entry is left again
  const toolMark = () => {
    const tool = root.dataset.tool ?? "";
    if (tool === toolMarked || !has("fpost")) return;
    if (tool && !toolMarked) { toolMarked = tool; mark(true); }
    else if (!tool && (history.state as { fflow?: Mark } | null)?.fflow?.tool) { toolMarked = ""; history.back(); }
    else { toolMarked = tool; mark(false); }
  };

  const mo = new MutationObserver(() => {
    toolMark();
    const s = done("s1");
    // the song ready: until the person chooses, a Reel of 30 s on its best part (a short song whole)
    if (s && !wasSong && !lengthTouched && (kind === "music" || kind === "photo")) {
      const [m, sc] = ($("mdur").textContent ?? "").split(":").map(Number);
      if ((m || 0) * 60 + (sc || 0) > 45) root.querySelector<HTMLButtonElement>('#slen [data-l="30"]')?.click();
    }
    wasSong = s;
    apply();
  });
  mo.observe(root, { attributes: true, attributeFilter: ["class", "data-tool", "data-nomake"] });
  ["s1", "s2", "s3", "copycard", "s1st"].forEach((id) => mo.observe($(id), { attributes: true, attributeFilter: ["class", "aria-pressed"], childList: true, characterData: true, subtree: id === "s1st" }));
  mo.observe($("aistat"), { attributes: true, attributeFilter: ["hidden"], childList: true, characterData: true, subtree: true });
  window.addEventListener("resize", apply, sig);
  // the waveform appears (or changes size) with the flow's steps: the engine draws it again on a resize
  let waveW = 0;
  const ro = new ResizeObserver(() => { const w = $("mwave").clientWidth; if (w && w !== waveW) { waveW = w; window.dispatchEvent(new Event("resize")); } });
  ro.observe($("mwave"));
  // this page's first screen (a reload starts the flow again: the song and clips were not kept)
  mark(false);
  apply();
  return () => { ac.abort(); mo.disconnect(); ro.disconnect(); refMo.disconnect(); place(false); };
}
