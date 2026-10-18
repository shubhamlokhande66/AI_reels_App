/* Auto Reel: the creator picks clips (and a song, if they like); the AI does everything else on this phone and the page
 * shows only the progress, then the finished video. Behind it is the same engine as the editor: the song is analysed,
 * the clips read, the AI picks the moments and the touch-ups, the sound is mixed and the video made (kept in the page,
 * not saved until the creator chooses). "Edit" opens the same Reel in the editor. Without a song: clips where people talk
 * make a talking Reel, otherwise the loudest clip's own sound becomes the song. */

import { TTS_VOICES } from "@/lib/tts/voices";

type Work = { song: boolean; songReady: boolean; beats: boolean; pending: number; clips: number; shots: number; ai: boolean; dir: boolean; speech: boolean; exporting: boolean; exportP: number };
type Studio = { work: Work; autoExport: () => Promise<Blob | null>; saveLast: () => void; autoSound: () => Promise<"talk" | "extract" | "none">;
  storyRun: (text: string, voice: string, song: File | null, clips: File[], onStage: (stage: string, p: number) => void) => Promise<void> };

const STAGES: [string, string][] = [
  ["song", "Listening to your song"], ["clips", "Reading your clips"], ["ai", "Choosing the best moments"],
  ["touch", "Touch-ups: framing, colour, voices"], ["video", "Making your video"],
];

const STORY_STAGES: [string, string][] = [
  ["voice", "Recording the narration"], ["clips", "Reading your clips and photos"], ["ai", "Building the scenes"],
  ["touch", "Touch-ups and captions"], ["video", "Making your video"],
];

export function initAuto(root: HTMLElement): () => void {
  const ac = new AbortController(), sig = { signal: ac.signal };
  const S = () => (root as unknown as { __studio?: Studio }).__studio;
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>("#" + id)!;
  const ov = document.createElement("div");
  ov.className = "autoov"; ov.id = "autoov"; ov.hidden = true;
  ov.innerHTML = `
    <div class="aopick" id="aopick">
      <button type="button" class="aox" data-ao="close" aria-label="Close">✕</button>
      <h2 id="aotitle">Auto Reel</h2><p class="sub" id="aosub">Pick your clips. The AI does the rest on this phone: cuts on the beat, best moments, framing, colour, sound.</p>
      <div class="aostory" id="aostory" hidden>
        <textarea id="aotext" rows="6" maxlength="3000" placeholder="Write your story… Each sentence becomes a scene, spoken and shown as captions."></textarea>
        <select id="aovoice" aria-label="Voice"></select>
      </div>
      <button type="button" class="aobig" data-ao="clips"><b id="aoclipsh">1 · Your clips</b><span id="aoclips">Videos from your phone</span></button>
      <button type="button" class="aobig" data-ao="song"><b>2 · A song (optional)</b><span id="aosong">Without one, your clips' own sound is used</span></button>
      <button type="button" class="btn save big" id="aogo" disabled>Make my Reel</button>
      <input type="file" id="aovfile" accept="video/*,image/*,.mov,.mp4,.m4v,.jpg,.jpeg,.png,.webp,.heic" multiple hidden><input type="file" id="aomfile" accept="audio/*,video/*,.mp3,.m4a,.aac,.wav" hidden>
    </div>
    <div class="aorun" id="aorun" hidden>
      <div class="aoring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" class="bg"/><circle cx="60" cy="60" r="52" class="fg" id="aoarc"/></svg><b id="aopct">0%</b></div>
      <h2 id="aostage">Starting…</h2>
      <ol class="aolist" id="aolist">${STAGES.map(([k, t]) => `<li data-s="${k}">${t}</li>`).join("")}</ol>
      <p class="sub">Keep this screen open. Nothing is uploaded.</p>
    </div>
    <div class="aodone" id="aodone" hidden>
      <video id="aovid" playsinline controls loop></video>
      <div class="row"><button type="button" class="btn save" data-ao="save">Save / Share</button><button type="button" class="btn" data-ao="edit">Edit in the studio</button><button type="button" class="btn ghost" data-ao="again">Make another</button></div>
    </div>`;
  root.appendChild(ov);
  let clips: File[] = [], songFile: File | null = null, running = false, url = "", mode: "auto" | "story" = "auto";
  const isPhoto = (f: File) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic)$/i.test(f.name);
  const ready = () => { $<HTMLButtonElement>("aogo").disabled = !clips.length || (mode === "story" && $<HTMLTextAreaElement>("aotext").value.trim().length < 10); };
  const pickMode = (m: "auto" | "story") => {
    mode = m; $("aostory").hidden = m !== "story";
    $("aotitle").textContent = m === "story" ? "Story → Reel" : "Auto Reel";
    $("aosub").textContent = m === "story" ? "Write it, pick a voice and your clips or photos. The AI narrates it, shows it scene by scene and adds the captions, on this phone." : "Pick your clips. The AI does the rest on this phone: cuts on the beat, best moments, framing, colour, sound.";
    $("aoclipsh").textContent = m === "story" ? "Your clips or photos" : "1 · Your clips";
    if (m === "story" && !$<HTMLSelectElement>("aovoice").options.length) $("aovoice").innerHTML = TTS_VOICES.map((v) => `<option value="${v.key}">${v.label}</option>`).join("");
    const names = m === "story" ? STORY_STAGES : STAGES; root.querySelectorAll<HTMLLIElement>("#aolist li").forEach((li, k) => { li.textContent = names[k][1]; });
    ready(); show("pick");
  };

  const show = (part: "pick" | "run" | "done" | null) => {
    ov.hidden = !part; root.classList.toggle("autoing", !!part);
    for (const [id, p] of [["aopick", "pick"], ["aorun", "run"], ["aodone", "done"]] as const) $(id).hidden = part !== p;
  };
  const feed = (id: string, files: File[]) => { const i = $<HTMLInputElement>(id), dt = new DataTransfer(); files.forEach((f) => dt.items.add(f)); i.files = dt.files; i.dispatchEvent(new Event("change", { bubbles: true })); };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const setProg = (p: number, stage: string, doneUpTo: number) => {
    const pct = Math.max(0, Math.min(100, Math.round(p * 100)));
    $("aopct").textContent = pct + "%"; $("aostage").textContent = stage;
    const arc = $("aoarc") as unknown as SVGCircleElement, L = 2 * Math.PI * 52; arc.style.strokeDasharray = `${L}`; arc.style.strokeDashoffset = `${L * (1 - pct / 100)}`;
    root.querySelectorAll<HTMLLIElement>("#aolist li").forEach((li, k) => { li.classList.toggle("ok", k < doneUpTo); li.classList.toggle("now", k === doneUpTo); });
  };

  async function run() {
    const st = S(); if (!st || running || !clips.length) return; running = true; show("run"); setProg(0, STAGES[0][1], 0);
    try {
      root.querySelector<HTMLButtonElement>('#kind [data-k="music"]')?.click();
      // photos become short moving clips first (the same as Photos to Reel)
      if (clips.some(isPhoto)) { const { photoClip } = await import("./steps"); const out: File[] = [];
        for (let i = 0; i < clips.length; i++) { setProg(0.02 + 0.08 * i / clips.length, "Preparing your photos", 0); out.push(isPhoto(clips[i]) ? await photoClip(clips[i]) : clips[i]); } clips = out; }
      if (mode === "story") {
        const names: Record<string, string> = { voice: "Recording the narration", song: "Setting the sound", clips: "Reading your clips" };
        await st.storyRun($<HTMLTextAreaElement>("aotext").value, $<HTMLSelectElement>("aovoice").value, songFile, clips, (stage, p) => setProg(stage === "voice" ? 0.05 + 0.15 * p : stage === "song" ? 0.22 : 0.3, names[stage] || stage, stage === "clips" ? 1 : 0));
      } else {
        if (songFile) feed("mfile", [songFile]);
        feed("vfile", clips);
      }
      // the engine works through it; the ring follows its state (each part weighs what it usually takes)
      const t0 = Date.now(); let extracted = !!songFile || mode === "story", quiet = 0;
      for (;;) {
        await wait(400); const w = st.work;
        if (!extracted && w.pending === 0 && w.clips > 0) { extracted = true; setProg(0.25, "Listening to your clips", 0); if ((await st.autoSound()) === "none") throw new Error("These clips have no sound. Add a song and try again."); continue; }
        const pClips = w.clips + w.pending ? w.clips / (w.clips + w.pending) : 0;
        const songP = w.songReady ? (w.beats ? 0.8 : 1) : w.song ? 0.4 : 0.1;
        const busy = w.pending > 0 || !w.songReady || w.beats || w.ai || w.dir || w.speech || !w.shots;
        const stage = !w.songReady ? 0 : w.pending > 0 ? 1 : w.ai || w.dir || !w.shots ? 2 : w.speech || w.beats ? 3 : 3;
        setProg(0.05 + 0.15 * songP + 0.3 * pClips + (w.shots ? 0.1 : 0) + (stage >= 3 ? 0.05 : 0), (mode === "story" ? STORY_STAGES : STAGES)[stage][1], stage);
        quiet = busy ? 0 : quiet + 1;
        if (quiet >= 3) break;   // settled for a moment (a late AI answer can still remake the edit)
        if (Date.now() - t0 > 10 * 60_000) throw new Error("This is taking too long. Try fewer or shorter clips.");
      }
      setProg(0.6, STAGES[4][1], 4);
      const tick = setInterval(() => { const w = st.work; if (w.exporting) setProg(0.6 + 0.4 * w.exportP, STAGES[4][1] + " · " + Math.round(w.exportP * 100) + "%", 4); }, 300);   // (the same last stage in both modes)
      let blob: Blob | null = null; try { blob = await st.autoExport(); } finally { clearInterval(tick); }
      if (!blob) throw new Error("The video could not be made on this phone.");
      setProg(1, "Done", STAGES.length);
      if (url) URL.revokeObjectURL(url); url = URL.createObjectURL(blob);
      const v = $<HTMLVideoElement>("aovid"); v.src = url; show("done"); v.play().catch(() => {});
    } catch (err) {
      $("aostage").textContent = String((err as Error)?.message || err); $("aopct").textContent = "!";
    } finally { running = false; }
  }

  ov.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>("[data-ao]")?.dataset.ao; if (!a) return;
    if (a === "close") show(null);
    else if (a === "clips") $("aovfile").click();
    else if (a === "song") $("aomfile").click();
    else if (a === "save") S()?.saveLast();
    else if (a === "edit") { $<HTMLVideoElement>("aovid").pause(); show(null); root.querySelector<HTMLButtonElement>('#views [data-view="editor"]')?.click(); }
    else if (a === "again") location.href = location.pathname + "?auto=" + (mode === "story" ? "story" : "1");
  }, sig);
  $("aovfile").addEventListener("change", (e) => { const f = [...((e.target as HTMLInputElement).files ?? [])]; (e.target as HTMLInputElement).value = ""; if (!f.length) return;
    clips = f; $("aoclips").textContent = f.length + (f.some(isPhoto) ? " file" : " clip") + (f.length > 1 ? "s" : "") + " · " + f.map((x) => x.name).slice(0, 3).join(", ") + (f.length > 3 ? "…" : ""); ready(); }, sig);
  $("aotext").addEventListener("input", ready, sig);
  $("aomfile").addEventListener("change", (e) => { const f = (e.target as HTMLInputElement).files?.[0]; (e.target as HTMLInputElement).value = ""; if (!f) return; songFile = f; $("aosong").textContent = f.name; }, sig);
  $("aogo").addEventListener("click", () => void run(), sig);
  $("autokind").addEventListener("click", () => pickMode("auto"), sig);
  $("storykind").addEventListener("click", () => pickMode("story"), sig);
  { const q = new URLSearchParams(location.search).get("auto"); if (q === "1") pickMode("auto"); else if (q === "story") setTimeout(() => pickMode("story"), 0); }
  return () => { ac.abort(); ov.remove(); if (url) URL.revokeObjectURL(url); };
}
