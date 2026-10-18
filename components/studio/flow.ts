/** Fast Studio's Create flow (UI/ design "After Clip Music Reel", phones and computers), on top of the engine's steps:
 *
 * Computers: one page. The header (back, "Music Reel", the four steps Music · Clips · AI Edit · Preview & Export), then
 *   1 Choose Music, 2 Add Your Clips, 3 AI Edit in a column, and the Reel Preview with Generate Reel beside them.
 * Phones: one screen at a time: the intro, choose music, adjust music (part, length, beats), add clips, analysing, then
 *   the finished Reel (the engine's own Simple view: "Your Reel is ready", Style / Text / Look / Music, Export).
 *
 * The engine makes the edit by itself as soon as there is a song and clips; the flow keeps that edit behind the
 * Analysing screen until Generate (computers) or Next (phones) is pressed, then hands the page to the editor views
 * (views.ts). A saved Reel that is opened again, Story → Reel and Copy a Reel skip the flow. Everything here shows,
 * hides or forwards to the engine's own controls (ids from markup.ts); the progress comes from tasks.ts events. */

import type { TaskEvent } from "./tasks";

type Kind = "music" | "talk" | "photo" | "copy";
type Step = "intro" | "choose" | "adjust" | "clips" | "analyse";

const KINDS: Record<Kind, { title: string; sub: string; intro: string; checks: string[]; icon: string }> = {
  music: { title: "Music Reel", sub: "Turn your clips into a stunning Reel with music, beats and AI edits.", intro: "Create a Music Reel", checks: ["Pick a song", "Add your videos or photos", "AI edits on the beat", "Preview, make changes and export"], icon: "music" },
  talk: { title: "Talking Reel", sub: "Your talking video, pauses cut, captions added, music under the voice.", intro: "Create a Talking Reel", checks: ["Add your talking video", "Pauses cut, captions added", "Soft music under the voice", "Preview, make changes and export"], icon: "voice" },
  photo: { title: "Photo Reel", sub: "Your photos, moving to the music, cut on the beat.", intro: "Create a Photo Reel", checks: ["Pick a song", "Add your photos", "AI moves them on the beat", "Preview, make changes and export"], icon: "image" },
  copy: { title: "Copy a Reel", sub: "Match a Reel you like: its cuts, texts and look on your clips.", intro: "Copy a Reel", checks: ["Pick the Reel to copy", "Add your clips", "AI copies its cuts and look", "Preview, make changes and export"], icon: "copy" },
};
const ORDER: Record<"music" | "talk", Step[]> = { music: ["intro", "choose", "adjust", "clips", "analyse"], talk: ["intro", "clips", "analyse"] };
// which engine task moves which line of the AI checklist (data-t in markup.ts)
const LINE_OF: Record<string, string> = { clips: "clips", beats: "beats", ai: "ai" };

export function initFlow(root: HTMLElement): () => void {
  const ac = new AbortController(), sig = { signal: ac.signal };
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>("#" + id)!;
  const q = new URLSearchParams(location.search);
  // a saved Reel, a Story or a picked template opens in the editor as before
  let revealed = q.has("p") || q.get("auto") === "story";
  let step: Step = "intro";
  let kind: Kind = "music";
  let pct = 0;
  const lines = new Map<string, "now" | "ok">();
  const phone = () => window.matchMedia("(max-width: 1023px)").matches;

  const has = (c: string) => root.classList.contains(c);
  const done = (id: string) => $(id).classList.contains("done");
  const made = () => has("made") || !$("s3").classList.contains("locked");
  const chosen = () => has("c1");
  const songOk = () => done("s1") || has("talkmode") || $("s1st").textContent?.startsWith("No song");
  const clipsOk = () => done("s2");
  const order = () => ORDER[has("talkmode") ? "talk" : "music"];

  // the kind in the address (/create/music|talking|photo): the flow is open from the first paint, before the engine
  // has picked that kind (it does a moment later, once it has started)
  const urlKind = (): Kind | null => ({ music: "music", talking: "talk", photo: "photo" } as Record<string, Kind>)[location.pathname.split("/")[2] ?? ""] ?? null;
  const readKind = (): Kind => {
    if (!chosen() && urlKind()) return urlKind()!;
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

  const setText = (el: Element, t: string) => { if (el.textContent !== t) el.textContent = t; };
  /** Each kind starts as it is meant: a Music Reel and a Photo Reel mute the clips' own sound under the song, a Talking
   * Reel keeps only the voices (Videos or Photos follow the kind: photomode). Only changed when it differs. */
  const defaults = (k: Kind) => {
    const want = k === "talk" ? "voices" : "mute";
    const b = root.querySelector<HTMLButtonElement>(`#csnd [data-c="${want}"]`);
    if (b && b.getAttribute("aria-pressed") !== "true") b.click();
  };
  const paintAi = () => {
    const make = made();
    for (const li of root.querySelectorAll<HTMLElement>(".faiList li")) {
      const t = li.dataset.t!;
      // the last line (the edit itself) runs once the song and clips are in; every line is done once the Reel is made
      const st = make ? "ok" : t === "make" ? (clipsOk() && songOk() ? "now" : "") : (lines.get(t) ?? "");
      li.classList.toggle("now", st === "now");
      li.classList.toggle("ok", st === "ok");
    }
    const all = [...root.querySelectorAll(".fanList li")], ok = all.filter((l) => l.classList.contains("ok")).length;
    const p = make ? 100 : Math.max(pct, Math.round((ok / all.length) * 100));
    setText($("fanpct"), p + "%");
    $("fanring").style.strokeDashoffset = String(326.7 * (1 - p / 100));
  };

  const apply = () => {
    const on = (chosen() || !!urlKind()) && !revealed && !has("autoing");
    root.classList.toggle("fopen", on);
    if (!on) { root.removeAttribute("data-fstep"); place(false); return; }
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
      if (!order().includes(step)) step = "intro";
      defaults(k);
      // each kind at its own address (/create/music, /create/talking, /create/photo); the same page, no reload
      const slug = { music: "music", talk: "talking", photo: "photo", copy: "" }[k];
      if (slug && location.pathname !== `/create/${slug}`) history.replaceState(history.state, "", `/create/${slug}${location.search.replace(/([?&])kind=[^&]*&?/, "$1").replace(/[?&]$/, "")}${location.hash}`);
    }
    root.dataset.fstep = step;
    root.dataset.fkind = kind;
    root.classList.add("flive"); // the kind's own words are in: the flow can be seen
    // the music card's title: choosing on computers and the phones' first screen, adjusting on the second
    const adj = phone() && step === "adjust";
    setText($("s1").querySelector("h2")!, adj ? "Adjust Music" : "Choose Music");
    setText($("s1").querySelector(".fsh")!, adj ? "Trim or select the best part of the song" : "Pick a song or sound for your Reel");
    place(true);
    // the header's steps: Music · Clips · AI Edit · Preview & Export
    const cur = !songOk() ? 1 : !clipsOk() ? 2 : 3;
    const mob = { intro: 1, choose: 1, adjust: 1, clips: 2, analyse: 3 }[step];
    const at = phone() ? mob : cur;
    root.querySelectorAll<HTMLElement>("#fsteps li").forEach((li) => {
      const n = +li.dataset.f!;
      li.classList.toggle("on", n === at);
      li.classList.toggle("ok", n < at);
    });
    // clips: Videos / Photos
    root.querySelectorAll<HTMLButtonElement>("#ftabs button").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.ft === "photos") === has("photomode"))));
    $("ftabs").hidden = has("talkmode") || kind === "copy";
    // Next on the clips step, Generate in the preview card
    const ready = clipsOk() && !!songOk();
    ($("fclipsnext") as HTMLButtonElement).disabled = !clipsOk();
    const gen = $<HTMLButtonElement>("fgen");
    gen.disabled = !ready;
    setText($("fgent"), "Generate Reel");
    setText($("freadyt"), made() ? "Your Reel is ready!" : ready ? "Making your Reel…" : "Ready to create your Reel!");
    setText($("freadys"), made() ? "Press Generate Reel to see it." : ready ? "The AI is reading your clips and the beats." : !songOk() ? "Choose a song, then add your clips." : "Add your clips, then press Generate.");
    setText($("fprevnote"), made() ? "Your Reel is ready" : "Your Reel appears here");
    $("fprevbox").classList.toggle("ready", made());
    paintAi();
    // the phones' analysing screen: the Reel opens once it is made
    if (step === "analyse" && made()) { revealed = true; setTimeout(apply, 350); }
  };

  const go = (s: Step) => {
    step = s;
    apply();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const next = () => {
    const o = order(), i = o.indexOf(step);
    if (step === "clips" && !songOk()) return go("choose"); // a Music Reel without a song yet
    if (i >= 0 && i < o.length - 1) go(o[i + 1]);
  };
  const back = () => {
    const o = order(), i = o.indexOf(step);
    if (phone() && i > 0) return go(o[i - 1]);
    if (history.length > 1) history.back();
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- plain DOM code, leaving the studio is a full load
    else location.href = "/";
  };

  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-fnext]")) { e.preventDefault(); next(); return; }
    if (t.closest("#fback")) { back(); return; }
    if (t.closest("#fskip")) { go(order()[1]); return; }
    if (t.closest("#fgen")) {
      if (made()) { revealed = true; apply(); setTimeout(() => $("s3").scrollIntoView({ behavior: "smooth", block: "start" }), 60); }
      else if (phone()) go("analyse");
      return;
    }
    const ft = t.closest<HTMLButtonElement>("#ftabs button");
    if (ft) {
      const photos = ft.dataset.ft === "photos";
      if (photos !== has("photomode")) (photos ? $("photokind") : root.querySelector<HTMLButtonElement>('#kind [data-k="music"]'))?.click();
      return;
    }
    // a new Reel (the home's "New Reel") starts the flow again
    if (t.closest("#pnew")) { revealed = false; step = "intro"; lines.clear(); pct = 0; delete $("ftitle").dataset.k; if (location.pathname !== "/studio") history.replaceState(history.state, "", "/studio"); setTimeout(apply); }
  }, { capture: true, ...sig });

  // a song that is ready moves the phones on to adjusting it
  let wasSong = done("s1");
  // the engine's progress (reading the clips, the beats, the AI) fills the checklist and the ring
  root.addEventListener("studio-task", (e) => {
    const d = (e as CustomEvent<TaskEvent>).detail, line = LINE_OF[d.id];
    if (line) lines.set(line, d.state === "done" ? "ok" : d.state === "fail" || d.state === "clear" ? lines.get(line) ?? "ok" : "now");
    if (d.id === "clips" && d.p !== null) pct = Math.max(pct, Math.round(d.p * 60));
    if (d.id === "clips" && d.title) { setText($("fant"), d.state === "done" ? "Clips read" : "Reading your clips…"); setText($("fand"), d.title); }
    paintAi();
  }, sig);

  const mo = new MutationObserver(() => {
    const s = done("s1");
    if (s && !wasSong && phone() && root.dataset.fstep === "choose") { wasSong = s; go("adjust"); return; }
    wasSong = s;
    apply();
  });
  mo.observe(root, { attributes: true, attributeFilter: ["class"] });
  ["s1", "s2", "s3", "copycard", "s1st"].forEach((id) => mo.observe($(id), { attributes: true, attributeFilter: ["class", "aria-pressed"], childList: true, characterData: true, subtree: id === "s1st" }));
  window.addEventListener("resize", apply, sig);
  // the waveform appears (or changes size) with the flow's steps: the engine draws it again on a resize
  let waveW = 0;
  const ro = new ResizeObserver(() => { const w = $("mwave").clientWidth; if (w && w !== waveW) { waveW = w; window.dispatchEvent(new Event("resize")); } });
  ro.observe($("mwave"));
  apply();
  return () => { ac.abort(); mo.disconnect(); ro.disconnect(); place(false); };
}
