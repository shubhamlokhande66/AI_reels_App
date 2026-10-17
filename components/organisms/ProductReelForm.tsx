"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { PICKER_AUDIO, PICKER_IMAGE, formatBytes, isAudioFile, isHeic, isImageFile } from "@/lib/format";
import type { ProductStyleInfo } from "@/types/api";
import { AudioRangePicker } from "@/components/molecules/AudioRangePicker";
import { ProgressBar } from "@/components/molecules/ProgressStages";
import { Icon } from "@/components/atoms";
import { ErrorBanner } from "@/components/molecules";

const FALLBACK_STYLES: ProductStyleInfo[] = [
  { id: "luxury_jewelry", name: "Luxury jewellery", description: "Slow, elegant camera; light sweeps across the metal; sparkles only on real reflections." },
  { id: "clean_product", name: "Clean product", description: "Crisp and modern: precise pushes, match cuts and zooms, no glitter." },
  { id: "energetic", name: "Energetic", description: "Fast and punchy: whips, flashes on the drops, light leaks, bold text." },
];

interface Photo {
  key: string;
  file: File;
  url: string; // an object URL, released when the photo is removed or the form goes away
}
type Step = "idle" | "creating" | "photos" | "music" | "directing";
const STEP_LABEL: Record<Step, string> = {
  idle: "",
  creating: "Creating the project…",
  photos: "Uploading photos…",
  music: "Uploading music…",
  directing: "Directing the Reel…",
};
const MAX_PHOTOS = 12;
const LENGTHS = [15, 20, 30] as const;
let seq = 0;

/** A Reel directed from product photos: the app plans the shots, camera, light, text and transitions, beat by beat. */
export function ProductReelForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const styles = useQuery({ queryKey: ["product-styles"], queryFn: api.productStyles, retry: false });
  const list = styles.data ?? FALLBACK_STYLES;
  const [name, setName] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [audio, setAudio] = useState<File | null>(null);
  const [audioStart, setAudioStart] = useState<number | null>(null);
  const [duration, setDuration] = useState(15);
  const [style, setStyle] = useState("luxury_jewelry");
  const [hook, setHook] = useState("");
  const [tagline, setTagline] = useState("");
  const [cta, setCta] = useState("");
  const [loop, setLoop] = useState(false);
  const [aiDirector, setAiDirector] = useState(true); // the AI plans the concept (validated); the renderer stays deterministic
  const [step, setStep] = useState<Step>("idle");
  const [pct, setPct] = useState(0);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const done = useRef<{ projectId?: string; photos?: boolean; audio?: boolean }>({});
  const latest = useRef<Photo[]>([]);
  useEffect(() => {
    latest.current = photos; // what to release when the form goes away
  }, [photos]);
  useEffect(() => () => latest.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  const busy = step !== "idle";
  const canSubmit = photos.length > 0 && !busy;

  function addPhotos(files: File[]) {
    setError(null);
    const heic = files.filter(isHeic);
    if (heic.length) setNotice(`HEIC photos can't be used yet (${heic.map((f) => f.name).join(", ")}). Export them as JPG and add them again.`);
    setPhotos((cur) => [...cur, ...files.filter((f) => !isHeic(f)).map((file) => ({ key: `p${++seq}`, file, url: URL.createObjectURL(file) }))]);
  }
  function removePhoto(key: string) {
    setPhotos((cur) => {
      const gone = cur.find((p) => p.key === key);
      if (gone) URL.revokeObjectURL(gone.url);
      return cur.filter((p) => p.key !== key);
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    try {
      if (!done.current.projectId) {
        setStep("creating");
        const p = await api.createProject(name.trim() || hook.trim() || "Product Reel", {
          reelType: "product", productStyle: style, hookText: hook.trim(), taglineText: tagline.trim(), ctaText: cta.trim(), loop, duration, ai: aiDirector, aiDirector,
          ...(audio && audioStart !== null ? { audioStart } : {}),
        });
        done.current.projectId = p.id;
      }
      const id = done.current.projectId;
      if (!done.current.photos) {
        setStep("photos");
        setPct(0);
        const res = await api.uploadImages(id, photos.map((p) => p.file), setPct);
        if (res.failed.length) setNotice(`Some photos were skipped: ${res.failed.map((f) => `${f.name}: ${f.error.message}`).join("; ")}`);
        if (res.uploaded.length === 0) throw new Error("None of the photos could be used.");
        done.current.photos = true;
      }
      if (audio && !done.current.audio) {
        setStep("music");
        setPct(0);
        await api.uploadAudio(id, audio, setPct);
        done.current.audio = true;
      }
      setStep("directing");
      await api.generateProduct(id);
      await qc.invalidateQueries({ queryKey: ["projects"] });
      router.push(`/projects/${id}`);
    } catch (err) {
      setError({ message: errorMessage(err), code: (err as { code?: string }).code });
      setStep("idle");
    }
  }

  const photoInput = useRef<HTMLInputElement>(null);
  const songInput = useRef<HTMLInputElement>(null);
  const pickPhotos = (list: FileList | null) => {
    if (!list || busy) return;
    const files = Array.from(list);
    const bad = files.filter((f) => !(isImageFile(f) || isHeic(f))).map((f) => f.name);
    if (bad.length) setError({ message: `These files are not photos we can use: ${bad.join(", ")}. Use JPG, PNG or WEBP.`, code: "UNSUPPORTED_MEDIA" });
    const room = MAX_PHOTOS - photos.length;
    const ok = files.filter((f) => isImageFile(f) || isHeic(f));
    if (ok.length > room) setNotice(`A Reel takes up to ${MAX_PHOTOS} photos, so the first ${Math.max(room, 0)} were added.`);
    if (ok.length && room > 0) addPhotos(ok.slice(0, room));
    if (photoInput.current) photoInput.current.value = "";
  };
  const pickSong = (list: FileList | null) => {
    const f = list?.[0];
    if (!f) return;
    if (!isAudioFile(f)) setError({ message: `${f.name} is not a song we can use. Try MP3, M4A or WAV.`, code: "UNSUPPORTED_MEDIA" });
    else {
      setError(null);
      setAudio(f);
      setAudioStart(null);
    }
    if (songInput.current) songInput.current.value = "";
  };
  const chosen = list.find((x) => x.id === style);

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" aria-label="Create product Reel">
      <section
        className="card"
        aria-label="Product photos"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          pickPhotos(e.dataTransfer.files);
        }}
      >
        <div className="between">
          <span className="h2">Product photos</span>
          <span className="mu sm">
            {photos.length} of {MAX_PHOTOS}
          </span>
        </div>
        <ul className="g4 sm:!grid-cols-6" aria-label="Photos">
          {photos.map((p) => (
            <li key={p.key} className="photo relative aspect-square">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={p.file.name} />
              <button
                type="button"
                aria-label={`Remove ${p.file.name}`}
                disabled={busy}
                onClick={() => removePhoto(p.key)}
                className="absolute right-1 top-1 z-[1] grid h-6 w-6 place-items-center rounded-full bg-black/65 text-white"
              >
                <Icon name="close" size={12} stroke={2.4} />
              </button>
            </li>
          ))}
          {photos.length < MAX_PHOTOS && (
            <li>
              <button
                type="button"
                aria-label="Add photos"
                disabled={busy}
                onClick={() => photoInput.current?.click()}
                className="drop grid aspect-square w-full place-items-center"
              >
                <Icon name="plus" size={22} />
              </button>
            </li>
          )}
        </ul>
        <input ref={photoInput} type="file" accept={PICKER_IMAGE} multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => pickPhotos(e.target.files)} />
        <span className="mu xs">
          {photos.length ? "Sharp photos of 1200 pixels or more let the camera move in close." : "One good photo is enough; more give the director more angles. Your product is never redrawn."}
        </span>
      </section>

      <section className="card" aria-label="Song">
        <div className="row">
          <span className="it b5" style={{ width: 36, height: 36 }}>
            <Icon name="music" size={18} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="truncate">{audio ? audio.name : "Song"}</b>
            <span className="mu sm">{audio ? `${formatBytes(audio.size)} · cuts and text land on its beats` : "Drop a song or tap to choose"}</span>
          </span>
          {audio ? (
            <button type="button" disabled={busy} className="btn sm" onClick={() => setAudio(null)}>
              Remove
            </button>
          ) : (
            <button type="button" disabled={busy} className="btn sm" onClick={() => songInput.current?.click()}>
              Choose
            </button>
          )}
        </div>
        <input ref={songInput} type="file" accept={PICKER_AUDIO} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => pickSong(e.target.files)} />
        {audio && <AudioRangePicker bare source={audio} duration={duration} start={audioStart} onChange={setAudioStart} />}
      </section>

      <section className="card" aria-label="Length and look">
        <span className="h2">Length and look</span>
        <div className="tabs2" role="radiogroup" aria-label="Length">
          {LENGTHS.map((d) => (
            <button key={d} type="button" role="radio" aria-checked={duration === d} disabled={busy} className={duration === d ? "on" : ""} onClick={() => setDuration(d)}>
              {d} s
            </button>
          ))}
        </div>
        <div className="chips w" role="radiogroup" aria-label="Look">
          {list.map((x) => (
            <button key={x.id} type="button" role="radio" aria-checked={style === x.id} disabled={busy} className={`chip ${style === x.id ? "on" : ""}`} onClick={() => setStyle(x.id)}>
              {x.name}
            </button>
          ))}
        </div>
        {chosen && <span className="mu xs">{chosen.description}</span>}
      </section>

      <section className="card" aria-label="Text and settings">
        <div className="g2">
          <label className="f">
            Hook line
            <input aria-label="Hook line" className="inp" value={hook} maxLength={80} disabled={busy} onChange={(e) => setHook(e.target.value)} placeholder="The Solitaire" />
          </label>
          <label className="f">
            Tagline
            <input aria-label="Tagline" className="inp" value={tagline} maxLength={80} disabled={busy} onChange={(e) => setTagline(e.target.value)} placeholder="Made by hand" />
          </label>
        </div>
        <label className="f">
          Call to action
          <input aria-label="Call to action" className="inp" value={cta} maxLength={80} disabled={busy} onChange={(e) => setCta(e.target.value)} placeholder="Shop now" />
        </label>
        <label className="f">
          Name your Reel <span className="font-normal">(optional)</span>
          <input id="product-name" className="inp" value={name} maxLength={120} disabled={busy} onChange={(e) => setName(e.target.value)} placeholder="e.g. Solitaire ring launch" />
        </label>
        <Toggle label="AI director plans every shot" on={aiDirector} disabled={busy} onChange={setAiDirector} />
        <Toggle label="Loop: the end flows back into the start" on={loop} disabled={busy} onChange={setLoop} />
      </section>

      {notice && (
        <p role="status" className="card sm" style={{ color: "var(--warning)", borderColor: "color-mix(in srgb, var(--warning) 35%, var(--border))" }}>
          {notice}
        </p>
      )}
      {error && <ErrorBanner title="Could not create the Reel" message={error.message} code={error.code} />}

      {busy && (
        <div aria-live="polite">
          <p className="mu sm mb-1">{STEP_LABEL[step]}</p>
          {(step === "photos" || step === "music") && <ProgressBar value={pct * 100} label="Upload progress" showEta />}
        </div>
      )}
      <button type="submit" disabled={!canSubmit} className="btn g big">
        {busy ? "Working…" : "Create product Reel"}
      </button>
      {!canSubmit && !busy && <p className="mu xs text-center">Add at least one product photo to continue.</p>}
    </form>
  );
}

/** An on / off switch row (design: a label and a gold toggle). */
export function Toggle({ label, hint, on, onChange, disabled }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="between sm">
      <span className="min-w-0">
        <span className="block">{label}</span>
        {hint && <span className="mu xs block">{hint}</span>}
      </span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className="tog disabled:opacity-50" onClick={() => onChange(!on)}>
        <i />
      </button>
    </div>
  );
}
