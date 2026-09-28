"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { PICKER_AUDIO, PICKER_IMAGE, formatBytes, isAudioFile, isHeic, isImageFile } from "@/lib/format";
import type { ProductStyleInfo } from "@/types/api";
import { AudioRangePicker } from "./AudioRangePicker";
import { Dropzone } from "./Dropzone";
import { ProgressBar } from "./ProgressStages";
import { DurationSelector } from "./StyleSelector";
import { btnDanger, btnPrimary, btnSecondary, Card, ErrorBanner } from "./ui";

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
const FIELD = "w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60";
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
  const canSubmit = name.trim().length > 0 && photos.length > 0 && !busy;

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
        const p = await api.createProject(name.trim(), {
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

  return (
    <form onSubmit={submit} className="space-y-8" aria-label="Create product Reel">
      <section>
        <label htmlFor="product-name" className="mb-1.5 block text-sm font-medium">
          Project name
        </label>
        <input id="product-name" value={name} maxLength={120} disabled={busy} onChange={(e) => setName(e.target.value)} placeholder="e.g. Solitaire ring launch" className={FIELD} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Product photos</h2>
        <p className="text-xs text-muted">
          One good photo is enough; more give the director more angles. Sharp photos of at least 1200 pixels let it move in close. The product is never redrawn or
          changed: the camera only crops, scales and lights your original photos.
        </p>
        <Dropzone
          label="Drag & drop your product photos here"
          hint="JPG, PNG, WEBP · up to 40 MB each"
          accept={PICKER_IMAGE}
          multiple
          disabled={busy}
          validate={(f) => isImageFile(f) || isHeic(f)}
          onReject={(n) => setError({ message: `Unsupported photo: ${n.join(", ")}`, code: "UNSUPPORTED_MEDIA" })}
          onFiles={addPhotos}
        />
        {photos.length > 0 && (
          <ul aria-label="Photos" className="grid grid-cols-3 gap-3 sm:grid-cols-5">
            {photos.map((p) => (
              <li key={p.key} className="relative overflow-hidden rounded-xl border border-border bg-surface">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.file.name} className="aspect-square w-full object-cover" />
                <p className="truncate px-2 py-1 text-[11px] text-muted">
                  {p.file.name} · {formatBytes(p.file.size)}
                </p>
                <button type="button" aria-label={`Remove ${p.file.name}`} disabled={busy} onClick={() => removePhoto(p.key)} className="absolute right-1 top-1 rounded-full bg-black/60 px-2 py-0.5 text-xs">
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Look</h2>
        <div role="radiogroup" aria-label="Product style" className="grid gap-3 sm:grid-cols-3">
          {list.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={style === s.id}
              disabled={busy}
              onClick={() => setStyle(s.id)}
              className={`rounded-xl border p-3 text-left transition-colors ${style === s.id ? "border-accent bg-accent/10" : "border-border bg-surface hover:border-accent/50"}`}
            >
              <span className="block text-sm font-medium">{s.name}</span>
              <span className="mt-1 block text-xs text-muted">{s.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">
          On-screen text <span className="font-normal text-muted">(all optional; keep it short)</span>
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs text-muted">
            Hook line
            <input aria-label="Hook line" value={hook} maxLength={80} disabled={busy} onChange={(e) => setHook(e.target.value)} placeholder="The Solitaire" className={`${FIELD} mt-1`} />
          </label>
          <label className="text-xs text-muted">
            Tagline
            <input aria-label="Tagline" value={tagline} maxLength={80} disabled={busy} onChange={(e) => setTagline(e.target.value)} placeholder="Made by hand" className={`${FIELD} mt-1`} />
          </label>
          <label className="text-xs text-muted">
            Call to action
            <input aria-label="Call to action" value={cta} maxLength={80} disabled={busy} onChange={(e) => setCta(e.target.value)} placeholder="Shop now" className={`${FIELD} mt-1`} />
          </label>
        </div>
        <p className="text-xs text-muted">The director times each line to a shot and places it where it covers the product least.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Length</h2>
        <DurationSelector value={duration} onChange={setDuration} disabled={busy} />
        <p className="text-xs text-muted">Product Reels work best at 10–20 seconds.</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={loop} disabled={busy} onChange={(e) => setLoop(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
          Make it loop: the last frame returns to the first
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" aria-label="AI director" checked={aiDirector} disabled={busy} onChange={(e) => setAiDirector(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
          <span>
            AI director
            <span className="block text-xs text-muted">
              The AI looks at your photos and plans the story (hook, reveal, hero, detail, call to action), camera moves and texts. Every
              choice is checked; the product is always rendered from your own photo. Your own texts always win.
            </span>
          </span>
        </label>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">
          Music <span className="font-normal text-muted">(optional)</span>
        </h2>
        {audio ? (
          <Card className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{audio.name}</p>
                <p className="text-xs text-muted">{formatBytes(audio.size)}</p>
              </div>
              <button type="button" disabled={busy} className={btnSecondary} onClick={() => setAudio(null)}>
                Remove music
              </button>
            </div>
            <AudioRangePicker bare source={audio} duration={duration} start={audioStart} onChange={setAudioStart} />
          </Card>
        ) : (
          <Dropzone
            label="Drop your song here"
            hint="Every cut, effect and text lands on its beats. Without music the shots follow a steady rhythm."
            accept={PICKER_AUDIO}
            disabled={busy}
            validate={isAudioFile}
            onReject={(n) => setError({ message: `Unsupported audio file: ${n.join(", ")}`, code: "UNSUPPORTED_MEDIA" })}
            onFiles={(files) => {
              setError(null);
              setAudio(files[0]);
            }}
          />
        )}
      </section>

      {notice && (
        <p role="status" className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          {notice}
        </p>
      )}
      {error && <ErrorBanner title="Could not create the Reel" message={error.message} code={error.code} />}

      <div className="space-y-3">
        {busy && (
          <div aria-live="polite">
            <p className="mb-1 text-sm text-muted">{STEP_LABEL[step]}</p>
            {(step === "photos" || step === "music") && <ProgressBar value={pct * 100} label="Upload progress" />}
          </div>
        )}
        <button type="submit" disabled={!canSubmit} className={`${btnPrimary} w-full py-3 text-base sm:w-auto`}>
          {busy ? "Working…" : "Direct my Reel"}
        </button>
        {!canSubmit && !busy && <p className="text-xs text-muted">Add a name and at least one product photo to continue.</p>}
        {photos.length > 0 && !busy && (
          <button type="button" className={btnDanger} onClick={() => photos.forEach((p) => removePhoto(p.key))}>
            Remove all photos
          </button>
        )}
      </div>
    </form>
  );
}
