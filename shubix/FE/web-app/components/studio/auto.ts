/* Story -> Reel (/create/story): the creator picks clips (and a song, if they like); the AI does everything else on this phone and the page
 * shows only the progress, then the finished video. Behind it is the same engine as the editor: the song is analysed,
 * the clips read, the AI picks the moments and the touch-ups, the sound is mixed and the video made (kept in the page,
 * not saved until the creator chooses). "Edit" opens the same Reel in the editor. Without a song: clips where people talk
 * make a talking Reel, otherwise the loudest clip's own sound becomes the song. */

import { TTS_VOICES } from "@/lib/tts/voices";

type Work = { song: boolean; songReady: boolean; beats: boolean; pending: number; clips: number; shots: number; ai: boolean; dir: boolean; speech: boolean; exporting: boolean; exportP: number };
type Studio = { work: Work; autoExport: () => Promise<Blob | null>; saveLast: () => void; autoSound: () => Promise<"talk" | "extract" | "none">;
  storyRun: (text: string, voice: string, song: File | null, clips: File[], onStage: (stage: string, p: number) => void, per?: number) => Promise<void> };

/** the sentences of a story: the engine speaks and captions the same ones (engine.ts storySentences) */
const sentencesOf = (t: string) => (t.replace(/\s+/g, " ").match(/[^.!?।]+[.!?।]*/g) || []).map((s) => s.trim()).filter((s) => s.length > 1);
const EXAMPLES: [string, string][] = [
  ["The thirsty crow", "On a hot summer day, a thirsty crow flew over the village looking for water. At last he found a pot with a little water at the bottom. His beak could not reach it. He dropped pebbles into the pot, one by one. The water rose, and the clever crow drank happily."],
  ["Krishna and the butter", "Little Krishna loved fresh butter more than anything. One morning, Yashoda went to the river and left the butter pot hanging high. Krishna and his friends made a tower and reached the pot. They ate the butter and laughed. When Yashoda came back, she smiled at the little butter thief."],
  ["Sunset in Goa", "The sun rises slowly over the calm sea in Goa. Fishermen push their colourful boats into the water. By noon, the beach is full of music and laughter. In the evening, the sky turns orange and pink. The day ends with lights shining on the waves."],
];
type StoryStyle = { id: string; name: string; free: boolean };

/** how long the finished phone edit waits for the AI's choices before the video is made anyway */
const AI_WAIT = 20_000;

const STAGES: [string, string][] = [
  ["song", "Listening to your song"], ["clips", "Reading your clips"], ["ai", "Choosing the best moments"],
  ["touch", "Touch-ups: framing, colour, voices"], ["video", "Making your video"],
];

const STORY_STAGES: [string, string][] = [
  ["pics", "Finding a picture for each scene"], ["voice", "Recording the narration"], ["clips", "Reading your clips and photos"], ["ai", "Building the scenes"],
  ["touch", "Touch-ups and captions"], ["video", "Making your video"],
];

export function initAuto(root: HTMLElement): () => void {
  const ac = new AbortController(), sig = { signal: ac.signal };
  const S = () => (root as unknown as { __studio?: Studio }).__studio;
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>("#" + id)!;
  const ov = document.createElement("div");
  ov.className = "autoov"; ov.id = "autoov"; ov.hidden = true;
  const svg = (d: string) => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    clips: svg('<rect x="2.5" y="6" width="13" height="12" rx="2"/><path d="M15.5 10l6-3v10l-6-3z"/>'),
    song: svg('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
    spark: svg('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>'),
    back: svg('<path d="M15 6l-6 6 6 6"/>'),
    chev: svg('<path d="M9 6l6 6-6 6"/>'),
    check: svg('<path d="M5 12l5 5 9-10"/>'),
    save: svg('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>'),
    edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
    again: svg('<path d="M4 12a8 8 0 0 1 14-5.3L20 9"/><path d="M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-14 5.3L4 15"/><path d="M4 20v-5h5"/>'),
    pic: svg('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>'),
    voice: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
  };
  ov.innerHTML = `
    <div class="aopick" id="aopick">
      <button type="button" class="aoback" data-ao="close">${ICON.back}<span>Back</span></button>
      <div class="aohead">
        <h1 id="aotitle">Story → Reel</h1>
        <p class="sub" id="aosub">Pick your clips. Shubix does the rest: the best moments, cuts on the beat, transitions, colour and sound.</p>
      </div>
      <div class="aostory" id="aostory" hidden>
        <div class="aocol">
          <div class="step aowrite">
            <div class="aorow"><label class="aolabel" for="aotext">Your story</label><span class="aocount" id="aocount">0 scenes</span></div>
            <textarea id="aotext" rows="9" maxlength="3000" placeholder="Write your story… Each sentence becomes a scene: a picture, the narration and the captions."></textarea>
            <div class="aoex"><span>Try one:</span>${EXAMPLES.map(([n], i) => `<button type="button" class="aochip" data-ex="${i}">${n}</button>`).join("")}</div>
          </div>
        </div>
        <div class="aocol">
          <div class="step">
            <span class="aolabel">${ICON.pic}<span>Pictures</span></span>
            <div class="aostyles" id="aostyles" role="radiogroup" aria-label="Picture style"></div>
            <p class="aohint" id="aostylehint">Shubix finds a picture for every scene.</p>
          </div>
          <div class="step">
            <label class="aolabel" for="aovoice">${ICON.voice}<span>Narrator</span></label>
            <select id="aovoice"></select>
          </div>
        </div>
      </div>
      <button type="button" class="aobig" data-ao="clips"><span class="aoic aoic1">${ICON.clips}</span><span class="aotx"><b id="aoclipsh">Your clips</b><span id="aoclips">Videos or photos from your phone</span></span><span class="aochev">${ICON.chev}</span></button>
      <button type="button" class="aobig" data-ao="song"><span class="aoic aoic2">${ICON.song}</span><span class="aotx"><b>A song <em>optional</em></b><span id="aosong">Without one, your clips' own sound is used</span></span><span class="aochev">${ICON.chev}</span></button>
      <p class="aonote">${ICON.spark}<span id="aonotetx">Made on your phone. Your videos are never uploaded.</span></p>
      <button type="button" class="btn save big aogo" id="aogo" disabled>Make my Reel</button>
      <input type="file" id="aovfile" accept="video/*,image/*,.mov,.mp4,.m4v,.jpg,.jpeg,.png,.webp,.heic" multiple hidden><input type="file" id="aomfile" accept="audio/*,video/*,.mp3,.m4a,.aac,.wav" hidden>
    </div>
    <div class="aorun" id="aorun" hidden>
      <div class="aoposter" aria-hidden="true">
        <div class="aoposterimg" id="aoposter"></div>
        <div class="aoglow"></div>
        <div class="aoring"><svg viewBox="0 0 120 120"><defs><linearGradient id="aograd" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e879f9"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs><circle cx="60" cy="60" r="52" class="bg"/><circle cx="60" cy="60" r="52" class="fg" id="aoarc"/></svg><b id="aopct">0%</b></div>
      </div>
      <div class="aoinfo">
        <span class="aoeyebrow">${ICON.spark}<span id="aoeyebrow">Making your Reel</span></span>
        <h2 id="aostage" aria-live="polite">Starting…</h2>
        <div class="aobar" role="progressbar" aria-label="Progress"><i id="aobar"></i></div>
        <div class="aopics" id="aopics" hidden></div>
        <ol class="aolist" id="aolist">${STAGES.map(([k, t]) => `<li data-s="${k}">${t}</li>`).join("")}</ol>
        <p class="aokeep" id="aokeep">Keep this screen open. Nothing is uploaded.</p>
      </div>
    </div>
    <div class="aodone" id="aodone" hidden>
      <div class="aodonebox">
        <div class="aovidwrap"><video id="aovid" playsinline controls loop></video></div>
        <div class="aoside">
          <span class="aoready">${ICON.check}<span>Ready</span></span>
          <h1>Your Reel is ready</h1>
          <p class="sub">Watch it, then save it to your phone or change anything in the editor.</p>
          <p class="aometa" id="aometa"></p>
          <div class="aoacts">
            <button type="button" class="aobtn pri" data-ao="save">${ICON.save}<span>Save / Share</span></button>
            <button type="button" class="aobtn" data-ao="edit">${ICON.edit}<span>Edit in the studio</span></button>
            <button type="button" class="aobtn ghost" data-ao="again">${ICON.again}<span>Make another</span></button>
          </div>
          <details class="aocredits" id="aocredits" hidden><summary>Picture credits</summary><ol id="aocredlist"></ol></details>
        </div>
      </div>
    </div>`;
  root.appendChild(ov);
  let clips: File[] = [], songFile: File | null = null, running = false, url = "", mode: "auto" | "story" = "auto", style = "classical", styles: StoryStyle[] = [], off = 0, base = 0, credits: string[] = [];
  const isPhoto = (f: File) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic)$/i.test(f.name);
  const ready = () => {
    if (mode !== "story") { $<HTMLButtonElement>("aogo").disabled = !clips.length; return; }
    // a story needs only its words: clips or photos of your own are optional
    const n = sentencesOf($<HTMLTextAreaElement>("aotext").value).length;
    $("aocount").textContent = n === 1 ? "1 scene" : n + " scenes";
    $<HTMLButtonElement>("aogo").disabled = $<HTMLTextAreaElement>("aotext").value.trim().length < 10;
    $("aostylehint").textContent = clips.length ? "Your own clips and photos are used instead of pictures." : styles.find((s) => s.id === style)?.free === false ? "Shubix makes a picture for every scene (uses credits)." : "Shubix finds a free picture for every scene.";
    root.querySelectorAll<HTMLButtonElement>("#aostyles button").forEach((b) => { b.disabled = !!clips.length; });
  };
  const drawStyles = () => {
    $("aostyles").innerHTML = styles.map((s) => `<button type="button" role="radio" class="aochip" aria-checked="${s.id === style}" data-st="${s.id}">${s.name}${s.free ? "" : " <em>AI</em>"}</button>`).join("");
    ready();
  };
  const loadStyles = async () => {
    styles = [{ id: "classical", name: "Classical painting", free: true }, { id: "photo", name: "Real photos", free: true }]; drawStyles();
    try { const r = await fetch("/api/studio/story"); if (r.ok) { styles = (await r.json()).styles; drawStyles(); } } catch { /* the free styles stay */ }
  };
  const pickMode = (m: "auto" | "story") => {
    mode = m; $("aostory").hidden = m !== "story";
    $("aotitle").textContent = m === "story" ? "Story Maker" : "Auto Reel";
    $("aosub").textContent = m === "story" ? "Write your story and pick a voice. Shubix finds a picture for every scene, narrates it and adds the captions." : "Pick your clips. Shubix does the rest on this phone: cuts on the beat, best moments, framing, colour, sound.";
    $("aopick").classList.toggle("aowide", m === "story");
    root.querySelector<HTMLElement>("#aopick .aoback")!.hidden = m === "story"; // Story Maker's own page: the app's Back is there
    // a story: the clips, song and button go in the right column, under the pictures and the voice
    const side = root.querySelectorAll<HTMLElement>("#aostory .aocol")[1], pick = $("aopick");
    for (const el of [...pick.querySelectorAll<HTMLElement>(":scope > .aobig, :scope > .aonote, :scope > .aogo"), ...side.querySelectorAll<HTMLElement>(":scope > .aobig, :scope > .aonote, :scope > .aogo")])
      (m === "story" ? side : pick).insertBefore(el, m === "story" ? null : $("aovfile"));
    $("aonotetx").textContent = m === "story" ? "Only your story's words are sent, to find the pictures. The video is made on your phone." : "Made on your phone. Your videos are never uploaded.";
    $("aoclipsh").innerHTML = m === "story" ? "Your own clips or photos <em>optional</em>" : "Your clips";
    if (m === "story") { $("aoclips").textContent = "Instead of the pictures Shubix finds"; $("aosong").textContent = "Plays softly under the narration"; if (!styles.length) void loadStyles(); }
    if (m === "story" && !$<HTMLSelectElement>("aovoice").options.length) $("aovoice").innerHTML = TTS_VOICES.map((v) => `<option value="${v.key}">${v.label}</option>`).join("");
    $("aolist").innerHTML = (m === "story" ? STORY_STAGES : STAGES).map(([k, t]) => `<li data-s="${k}">${t}</li>`).join("");
    ready(); show("pick");
  };

  const show = (part: "pick" | "run" | "done" | null) => {
    ov.hidden = !part; root.classList.toggle("autoing", !!part);
    if (part) window.scrollTo({ top: 0 });
    for (const [id, p] of [["aopick", "pick"], ["aorun", "run"], ["aodone", "done"]] as const) $(id).hidden = part !== p;
  };
  const feed = (id: string, files: File[]) => { const i = $<HTMLInputElement>(id), dt = new DataTransfer(); files.forEach((f) => dt.items.add(f)); i.files = dt.files; i.dispatchEvent(new Event("change", { bubbles: true })); };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const setProg = (p0: number, stage: string, doneUpTo0: number, raw = false) => {
    const p = raw ? p0 : base + (1 - base) * p0, doneUpTo = raw ? doneUpTo0 : doneUpTo0 + off;
    const pct = Math.max(0, Math.min(100, Math.round(p * 100)));
    $("aopct").textContent = pct + "%"; $("aostage").textContent = stage;
    $("aobar").style.width = pct + "%"; $("aobar").parentElement!.setAttribute("aria-valuenow", String(pct));
    const arc = $("aoarc") as unknown as SVGCircleElement, L = 2 * Math.PI * 52; arc.style.strokeDasharray = `${L}`; arc.style.strokeDashoffset = `${L * (1 - pct / 100)}`;
    root.querySelectorAll<HTMLLIElement>("#aolist li").forEach((li, k) => { li.classList.toggle("ok", k < doneUpTo); li.classList.toggle("now", k === doneUpTo); });
  };

  async function run() {
    const st = S(); if (!st || running || (!clips.length && mode !== "story")) return; running = true;
    off = mode === "story" ? 1 : 0; base = 0; $("aopics").hidden = true; $("aopics").innerHTML = ""; $("aoposter").classList.remove("on"); $("aoposter").style.backgroundImage = "";
    $("aoeyebrow").textContent = mode === "story" ? "Making your story" : "Making your Reel";
    $("aokeep").textContent = mode === "story" ? "Keep this screen open: the video is made on your phone." : "Keep this screen open. Nothing is uploaded.";
    show("run");
    let per = 0; // a story told with Shubix's pictures: the sentences each picture covers
    try {
      if (mode === "story" && !clips.length) { per = await findPictures(); base = 0.3; }
      else setProg(0, mode === "story" ? STORY_STAGES[1][1] : STAGES[0][1], 0);
      root.querySelector<HTMLButtonElement>('#kind [data-k="music"]')?.click();
      // photos become short moving clips first (the same as Photos to Reel)
      if (clips.some(isPhoto)) { const { photoClip } = await import("./steps"); const out: File[] = [];
        for (let i = 0; i < clips.length; i++) { setProg(0.02 + 0.08 * i / clips.length, "Preparing your photos", 0); out.push(isPhoto(clips[i]) ? await photoClip(clips[i]) : clips[i]); } clips = out; }
      if (mode === "story") {
        const names: Record<string, string> = { voice: "Recording the narration", song: "Setting the sound", clips: "Reading your clips" };
        await st.storyRun($<HTMLTextAreaElement>("aotext").value, $<HTMLSelectElement>("aovoice").value, songFile, clips, (stage, p) => setProg(stage === "voice" ? 0.05 + 0.15 * p : stage === "song" ? 0.22 : 0.3, names[stage] || stage, stage === "clips" ? 1 : 0), per || undefined);
      } else {
        if (songFile) feed("mfile", [songFile]);
        feed("vfile", clips);
      }
      // the engine works through it; the ring follows its state (each part weighs what it usually takes)
      const t0 = Date.now(); let extracted = !!songFile || mode === "story", quiet = 0, aiSince = 0;
      for (;;) {
        await wait(400); const w = st.work;
        if (!extracted && w.pending === 0 && w.clips > 0) { extracted = true; setProg(0.25, "Listening to your clips", 0); if ((await st.autoSound()) === "none") throw new Error("These clips have no sound. Add a song and try again."); continue; }
        const pClips = w.clips + w.pending ? w.clips / (w.clips + w.pending) : 0;
        const songP = w.songReady ? (w.beats ? 0.8 : 1) : w.song ? 0.4 : 0.1;
        // the second beat check (on-device AI) is not waited for: it improves the Reel afterwards. The AI's own
        // choices get AI_WAIT after the rest is ready; a slower answer is used for the edit afterwards, not this video.
        const rest = w.pending > 0 || !w.songReady || w.speech || !w.shots, aiBusy = w.ai || w.dir;
        if (!rest && aiBusy && !aiSince) aiSince = Date.now();
        if (rest || !aiBusy) aiSince = 0;
        const busy = rest || (aiBusy && Date.now() - aiSince < AI_WAIT);
        const stage = !w.songReady ? 0 : w.pending > 0 ? 1 : w.ai || w.dir || !w.shots ? 2 : w.speech || w.beats ? 3 : 3;
        setProg(0.05 + 0.15 * songP + 0.3 * pClips + (w.shots ? 0.1 : 0) + (stage >= 3 ? 0.05 : 0), (mode === "story" ? STORY_STAGES[stage + 1] : STAGES[stage])[1], stage);
        quiet = busy ? 0 : quiet + 1;
        if (quiet >= 3) break;   // settled for a moment (a late AI answer can still remake the edit)
        if (Date.now() - t0 > 10 * 60_000) throw new Error("This is taking too long. Try fewer or shorter clips.");
      }
      setProg(0.6, STAGES[4][1], 4);
      const tick = setInterval(() => { const w = st.work; if (w.exporting) setProg(0.6 + 0.4 * w.exportP, STAGES[4][1] + " · " + Math.round(w.exportP * 100) + "%", 4); }, 300);   // (the same last stage in both modes)
      let blob: Blob | null = null; try { blob = await st.autoExport(); } finally { clearInterval(tick); }
      if (!blob) throw new Error("The video could not be made on this phone.");
      setProg(1, "Done", STAGES.length);
      if (per) clips = []; // a new story finds new pictures
      if (url) URL.revokeObjectURL(url); url = URL.createObjectURL(blob);
      const v = $<HTMLVideoElement>("aovid"); v.src = url; show("done"); v.play().catch(() => {});
      const scenes = mode === "story" ? sentencesOf($<HTMLTextAreaElement>("aotext").value).length : 0;
      v.onloadedmetadata = () => { $("aometa").textContent = `${Math.round(v.duration)} s` + (scenes ? ` · ${scenes} scene${scenes > 1 ? "s" : ""}` : "") + " · 9:16"; };
      $("aocredits").hidden = !(per && credits.length); $("aocredlist").innerHTML = credits.map((c) => `<li>${c.replace(/[<&]/g, "")}</li>`).join("");
    } catch (err) {
      $("aostage").textContent = String((err as Error)?.message || err); $("aopct").textContent = "!";
    } finally { running = false; }
  }

  async function findPictures(): Promise<number> {
    const say = (p: number, t: string) => setProg(p, t, 0, true);
    const post = async (u: string, b: unknown) => {
      const r = await fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 402) window.dispatchEvent(new CustomEvent("credits:needed", { detail: j?.error?.message }));
      if (!r.ok) throw new Error(j?.error?.message || "Shubix could not find pictures right now. Try again, or add your own photos.");
      return j;
    };
    say(0.02, "Reading your story");
    const plan = await post("/api/studio/story", { sentences: sentencesOf($<HTMLTextAreaElement>("aotext").value), style });
    credits = [];
    const { photoClip } = await import("./steps"), n = plan.scenes.length, reelId = "story" + Date.now().toString(36), seen: string[] = [], out: File[] = [];
    const strip = $("aopics"); strip.hidden = false;
    strip.innerHTML = plan.scenes.map((_: unknown, i: number) => `<span class="aopic" data-i="${i}"><b>${i + 1}</b></span>`).join("");
    for (let i = 0; i < n; i++) {
      say(0.04 + 0.24 * i / n, `Finding a picture for scene ${i + 1} of ${n}`);
      let pic: { image: string; ref: string; credit: string } | null = null;
      try { pic = await post("/api/studio/story/picture", { scene: plan.scenes[i], style, characters: plan.characters, skip: seen, reelId, i }); }
      catch (e) { if (!out.length) throw e; } // a scene without a picture keeps the one before it
      const cell = strip.querySelector<HTMLElement>(`[data-i="${i}"]`)!;
      if (!pic) { cell.classList.add("same"); out.push(out[out.length - 1]); continue; }
      if (pic.ref) seen.push(pic.ref);
      credits.push(`Scene ${i + 1}: ${pic.credit}`);
      cell.style.backgroundImage = `url("${pic.image}")`; cell.title = pic.credit; cell.classList.add("ok");
      const poster = $("aoposter"); poster.classList.remove("on"); void poster.offsetWidth; poster.style.backgroundImage = `url("${pic.image}")`; poster.classList.add("on");
      const blob = await (await fetch(pic.image)).blob();
      out.push(await photoClip(new File([blob], `scene-${i + 1}.jpg`, { type: "image/jpeg" })));
    }
    clips = out;
    return plan.per as number;
  }

  ov.addEventListener("click", (e) => {
    const ex = (e.target as HTMLElement).closest<HTMLElement>("[data-ex]"), sty = (e.target as HTMLElement).closest<HTMLElement>("[data-st]");
    if (ex) { $<HTMLTextAreaElement>("aotext").value = EXAMPLES[+ex.dataset.ex!][1]; ready(); return; }
    if (sty) { style = sty.dataset.st!; drawStyles(); return; }
    const a = (e.target as HTMLElement).closest<HTMLElement>("[data-ao]")?.dataset.ao; if (!a) return;
    if (a === "close") show(null);
    else if (a === "clips") $("aovfile").click();
    else if (a === "song") $("aomfile").click();
    else if (a === "save") S()?.saveLast();
    else if (a === "edit") { $<HTMLVideoElement>("aovid").pause(); show(null); }
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- plain DOM code: a fresh Story is a full load
    else if (a === "again") location.href = "/create/story";
  }, sig);
  $("aovfile").addEventListener("change", (e) => { const f = [...((e.target as HTMLInputElement).files ?? [])]; (e.target as HTMLInputElement).value = ""; if (!f.length) return;
    clips = f; $("aoclips").textContent = f.length + (f.some(isPhoto) ? " file" : " clip") + (f.length > 1 ? "s" : "") + " · " + f.map((x) => x.name).slice(0, 3).join(", ") + (f.length > 3 ? "…" : ""); ready(); }, sig);
  $("aotext").addEventListener("input", ready, sig);
  $("aomfile").addEventListener("change", (e) => { const f = (e.target as HTMLInputElement).files?.[0]; (e.target as HTMLInputElement).value = ""; if (!f) return; songFile = f; $("aosong").textContent = f.name; }, sig);
  $("aogo").addEventListener("click", () => void run(), sig);
  $("storykind").addEventListener("click", () => pickMode("story"), sig);
  if (location.pathname === "/create/story") setTimeout(() => pickMode("story"), 0); // Story Maker's own address
  return () => { ac.abort(); ov.remove(); if (url) URL.revokeObjectURL(url); };
}
