/** Fast Studio's four steps, one after the other (as a person makes a Reel):
 *   1 What are we making? (Music Reel, Talking Reel, Photos to Reel, Copy a Reel, or a template)
 *   2 Music   — shown once step 1 is chosen
 *   3 Clips   — shown once the song is ready (or "Continue without music" for a talking Reel)
 *   4 Your Reel — shown once there are clips; the engine makes the edit
 * Once the Reel is made every step stays reachable (the engine and views.ts fold them).
 *
 * Photos to Reel: each photo becomes a short moving shot (a slow push-in, encoded in the browser with WebCodecs),
 * then goes into the engine exactly like a video clip. Nothing is uploaded. */

const SHOT_SECONDS = 3;
const FPS = 30;

export function initSteps(root: HTMLElement): () => void {
  const $ = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
  const ac = new AbortController();
  const sig = { signal: ac.signal };
  let chosen = false, skip = false, kindNow: "music" | "talk" | "photo" | "copy" | null = null;
  // Music Reel with no song: the clips' own sound becomes the song (or, when people talk in them, a talking Reel)
  let clipSound = false, clipSoundAsked = false;
  const vfile = $("vfile") as HTMLInputElement;
  const VIDEO_ACCEPT = vfile.accept;

  const press = (which: "music" | "talk" | "photo" | "copy" | null) => {
    root.querySelectorAll<HTMLButtonElement>("#kind button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.k === which)));
    $("photokind").setAttribute("aria-pressed", String(which === "photo"));
    $("copycard").setAttribute("aria-pressed", String(which === "copy"));
  };
  const setPhoto = (on: boolean) => {
    root.classList.toggle("photomode", on);
    vfile.accept = on ? "image/*,.jpg,.jpeg,.png,.webp,.heic" : VIDEO_ACCEPT;
    const h = $("s2").querySelector("h2")!, st = $("s2st");
    const idle = (t: string) => /^(Several clips or one long video|Add your photos.*)$/.test(t);
    if (on) {
      h.textContent = "Your photos";
      if (idle(st.textContent ?? "")) st.textContent = "Add your photos (8 or more look best)";
    } else {
      if (!root.classList.contains("talkmode")) h.textContent = "Clips";
      if (idle(st.textContent ?? "")) st.textContent = "Several clips or one long video";
    }
  };
  const asMusic = () => {
    if (root.classList.contains("talkmode")) root.querySelector<HTMLButtonElement>('#kind [data-k="music"]')?.click();
  };
  const choose = (which: "music" | "talk" | "photo" | "copy", label: string) => {
    chosen = true; kindNow = which;
    setPhoto(which === "photo");
    // after the engine has handled the same click
    setTimeout(() => {
      press(which);
      $("s0st").textContent = label;
      update();
    });
  };

  // step 1: the choices (captured before the engine and views.ts see the click)
  root.addEventListener(
    "click",
    (e) => {
      const t = e.target as HTMLElement;
      const k = t.closest<HTMLButtonElement>("#kind button");
      if (k) return choose(k.dataset.k === "talk" ? "talk" : "music", k.dataset.k === "talk" ? "Talking Reel" : "Music Reel");
      if (t.closest("#photokind")) {
        asMusic();
        return choose("photo", "Photos to Reel");
      }
      if (t.closest("#copycard")) {
        asMusic();
        return choose("copy", "Copy a Reel");
      }
      if (t.closest("#tpl button")) {
        chosen = true;
        setPhoto(false);
        setTimeout(() => {
          press(root.classList.contains("talkmode") ? "talk" : null);
          $("s0st").textContent = `Template: ${t.closest<HTMLButtonElement>("#tpl button")!.textContent}`;
          update();
        });
        return;
      }
      if (t.closest("#skipmusic")) {
        skip = true;
        if (kindNow === "music") { clipSound = true; $("s2").classList.remove("locked"); $("s1st").textContent = "No song: your clips' own sound will be used"; }
        update();
        return;
      }
      if (t.closest("#pnew")) {
        // a new Reel starts at step 1 again
        chosen = skip = clipSound = clipSoundAsked = false; kindNow = null;
        setPhoto(false);
        setTimeout(() => {
          press(null);
          $("s0st").textContent = "Choose one to start";
          update();
        });
      }
    },
    { capture: true, signal: ac.signal },
  );

  // photos: turn them into short moving shots, then hand them to the engine as clips
  let feeding = false;
  const feed = async (list: File[]) => {
    const imgs = list.filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic)$/i.test(f.name));
    const rest = list.filter((f) => !imgs.includes(f));
    const out: File[] = [...rest];
    const st = $("s2st");
    for (let i = 0; i < imgs.length; i++) {
      st.textContent = `Turning photo ${i + 1} of ${imgs.length} into a moving shot…`;
      try {
        out.push(await photoClip(imgs[i]));
      } catch {
        st.textContent = `${imgs[i].name} could not be read. Use JPG, PNG or WEBP.`;
      }
    }
    if (!out.length) return;
    const dt = new DataTransfer();
    out.forEach((f) => dt.items.add(f));
    feeding = true;
    vfile.files = dt.files;
    vfile.dispatchEvent(new Event("change", { bubbles: true }));
    feeding = false;
  };
  const hasImages = (fl: FileList | File[] | null | undefined) => !!fl && [...fl].some((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic)$/i.test(f.name));
  root.addEventListener(
    "change",
    (e) => {
      if (e.target !== vfile || feeding || !hasImages(vfile.files)) return;
      e.stopPropagation();
      const list = [...vfile.files!];
      vfile.value = "";
      void feed(list);
    },
    { capture: true, signal: ac.signal },
  );
  root.addEventListener(
    "drop",
    (e) => {
      const dz = (e.target as HTMLElement).closest("#dropzone");
      if (!dz || !hasImages(e.dataTransfer?.files)) return;
      e.preventDefault();
      e.stopPropagation();
      dz.classList.remove("over");
      void feed([...e.dataTransfer!.files]);
    },
    { capture: true, signal: ac.signal },
  );

  // which steps are open: each one appears when the one before it is done
  const flags = { c1: false, c2: false, c3: false };
  const update = () => {
    const made = root.classList.contains("made");
    const talk = root.classList.contains("talkmode");
    const next = {
      c1: made || chosen,
      c2: made || (chosen && ($("s1").classList.contains("done") || skip)),
      c3: made || (chosen && (!$("s3").classList.contains("locked") || $("s2").classList.contains("done"))),
    };
    // no song: a talking Reel goes on without music; a Music Reel uses the clips' own sound
    const noSongOk = talk || kindNow === "music";
    $("skipmusic").hidden = !(noSongOk && chosen && !$("s1").classList.contains("done") && !skip);
    $("skipmusic").textContent = talk ? "Continue without music" : "No song? Use my clips' own sound";
    if (clipSound && !clipSoundAsked && !talk && $("s2").classList.contains("done") && !$("s1").classList.contains("done")) {
      clipSoundAsked = true;
      const st = (root as unknown as { __studio?: { autoSound?: () => Promise<"talk" | "extract" | "none"> } }).__studio;
      void st?.autoSound?.().then((r) => { if (r === "none") { $("s2st").textContent = "These clips have no sound. Add a song in step 2."; clipSound = skip = clipSoundAsked = false; update(); } });
    }
    for (const k of ["c1", "c2", "c3"] as const) {
      if (next[k] === flags[k]) continue;
      flags[k] = next[k];
      root.classList.toggle(k, next[k]);
      // bring the step that just opened into view (not when a saved Reel is opened)
      if (next[k] && !made) {
        const id = { c1: "s1", c2: "s2", c3: "s3" }[k];
        setTimeout(() => $(id).scrollIntoView({ behavior: "smooth", block: "start" }), 60);
      }
    }
  };
  const mo = new MutationObserver(update);
  ["s1", "s2", "s3"].forEach((id) => mo.observe($(id), { attributes: true, attributeFilter: ["class"] }));
  mo.observe(root, { attributes: true, attributeFilter: ["class"] });
  update();
  void sig;
  return () => {
    ac.abort();
    mo.disconnect();
  };
}

/** A photo as a short video: the whole picture with a slow push-in, encoded in the browser (WebCodecs, the same
 * encoder as the studio's export) so the clip has a real length. Nothing is uploaded. */
export async function photoClip(file: File): Promise<File> {
  const mb = await import("mediabunny");
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1080 / Math.max(bmp.width, bmp.height));
  const w = Math.max(16, Math.round((bmp.width * scale) / 2) * 2), h = Math.max(16, Math.round((bmp.height * scale) / 2) * 2);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const codec = await mb.getFirstEncodableVideoCodec(["avc", "vp9", "vp8"], { width: w, height: h });
  if (!codec) throw new Error("This browser cannot make video from photos.");
  const mp4 = codec === "avc";
  const output = new mb.Output({ format: mp4 ? new mb.Mp4OutputFormat({ fastStart: "in-memory" }) : new mb.WebMOutputFormat(), target: new mb.BufferTarget() });
  const vs = new mb.CanvasSource(c, { codec, bitrate: 6e6, keyFrameInterval: 1 });
  output.addVideoTrack(vs, { frameRate: FPS });
  await output.start();
  const frames = SHOT_SECONDS * FPS;
  for (let k = 0; k < frames; k++) {
    const z = 1 + 0.08 * (k / (frames - 1)); // a slow push-in
    g.fillStyle = "#000";
    g.fillRect(0, 0, w, h);
    g.drawImage(bmp, (w - w * z) / 2, (h - h * z) / 2, w * z, h * z);
    await vs.add(k / FPS, 1 / FPS);
  }
  await output.finalize();
  bmp.close();
  const buf = (output.target as InstanceType<typeof mb.BufferTarget>).buffer!;
  return new File([buf], `${file.name.replace(/\.[^.]+$/, "")}.${mp4 ? "mp4" : "webm"}`, { type: mp4 ? "video/mp4" : "video/webm" });
}
