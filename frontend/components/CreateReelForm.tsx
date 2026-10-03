"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { useTrends } from "@/hooks/useApi";
import { api, errorMessage } from "@/lib/api";
import { FEATURES } from "@/lib/features";
import { PICKER_AUDIO, PICKER_VIDEO, formatBytes, isAudioFile, isVideoFile } from "@/lib/format";
import { AudioRangePicker } from "./AudioRangePicker";
import { Dropzone } from "./Dropzone";
import { SongPicker } from "./Songs";
import { ProgressBar } from "./ProgressStages";
import { DurationSelector, OrderModeSelector, PaceSelector, SequenceSelector, StepOptions, StyleSelector, type PaceChoice } from "./StyleSelector";
import { btnPrimary, btnSecondary, Card, ErrorBanner } from "./ui";
import { LocalVideo, VideoList } from "./VideoList";
import { LANGUAGES, type Language, type Platform, type Sequence, type Template } from "@/types/api";

const AUDIO_MODES = [
  ["music", "Music only"],
  ["voice_music", "Voice-over + music"],
  ["voice", "Voice-over only"],
  ["original", "Original clip audio"],
  ["none", "No audio"],
] as const;
type AudioModeId = (typeof AUDIO_MODES)[number][0];
const SELECT = "w-full rounded-xl border border-border bg-surface px-3 py-2 outline-none focus:border-accent sm:w-auto";

type Step = "idle" | "creating" | "videos" | "audio" | "starting";
const STEP_LABEL: Record<Step, string> = {
  idle: "",
  creating: "Creating project…",
  videos: "Uploading videos…",
  audio: "Uploading music…",
  starting: "Starting the render…",
};

const CAPTION_STYLES = ["minimal", "bold", "karaoke", "highlight", "luxury"];

const PLATFORMS: { id: Platform; label: string; hint: string }[] = [
  { id: "instagram", label: "Instagram Reels", hint: "Edited and checked for how Instagram ranks Reels" },
  { id: "none", label: "General", hint: "The editor's own defaults, no platform rules" },
];

// What Instagram mode changes, in plain words (each line maps to a rule in backend/app/platforms/instagram.py)
const INSTAGRAM_RULES = [
  "Opens on your most eye-catching moment and cuts by 1.8 s, before people decide to scroll on.",
  "Your hook text is on screen from the first frame, and the music starts right away (most people watch muted at first).",
  "A new shot every 1-3.5 s to keep people watching, and an ending that loops back into the start for rewatches.",
  "No fade to black. A brand logo shows only in the last 2 s (Reels with a logo on screen are recommended less).",
  "Caption with searchable words, at most 5 specific hashtags, a line asking people to send it, and alt text.",
  "A ranking check after the render: what passes, what to fix, and how to post it.",
];

// Tap-to-add examples for the AI instruction box (plain words, not settings)
const INSTRUCTION_IDEAS = [
  "Luxury feel, slow and elegant.",
  "Lots of close-ups of the details.",
  "Energetic, cut on every beat.",
  "Start with the best shot.",
  "End on the full look.",
  "Add text: New Collection.",
];

let keySeq = 0;

export function CreateReelForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [videos, setVideos] = useState<LocalVideo[]>([]);
  const [audio, setAudio] = useState<File | null>(null);
  const [duration, setDuration] = useState(15);
  const [audioStart, setAudioStart] = useState<number | null>(null); // null = the app picks the best part of the song
  const [style, setStyle] = useState("auto"); // the AI picks the style from the instructions, clips and song
  const [pace, setPace] = useState<PaceChoice>("auto"); // the AI picks the pace too
  const [sequence, setSequence] = useState<Sequence>("mixed");
  const [teaser, setTeaser] = useState(true);
  const [stepLabels, setStepLabels] = useState(true);
  const [orderMode, setOrderMode] = useState<"auto" | "manual">("auto");
  const [captions, setCaptions] = useState(false);
  const [captionStyle, setCaptionStyle] = useState("minimal");
  const [aiDirector, setAiDirector] = useState(true); // the AI plans every shot; the safety layer checks it
  const [ai, setAi] = useState(true); // quality over speed by default: the app looks at every clip before picking shots (a few minutes on a local computer)
  const [trendId, setTrendId] = useState("");
  const [audioMode, setAudioMode] = useState<AudioModeId>("music");
  const [platform, setPlatform] = useState<Platform>("instagram");
  const [hookText, setHookText] = useState("");
  const [ctaText, setCtaText] = useState("");
  const [language, setLanguage] = useState<Language>("en");
  const [brief, setBrief] = useState("");
  const [brandId, setBrandId] = useState("");
  const [reference, setReference] = useState("auto"); // edit like a learned trend: the AI picks one unless the user does
  const [templateId, setTemplateId] = useState("");
  const templates = useQuery({ queryKey: ["templates"], queryFn: api.templates });
  const brands = useQuery({ queryKey: ["brands"], queryFn: api.brands });
  const learned = useQuery({ queryKey: ["references"], queryFn: api.references });
  const trends = useTrends();
  const [step, setStep] = useState<Step>("idle");
  const [uploadPct, setUploadPct] = useState(0);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Progress is remembered so "try again" resumes instead of duplicating the project/uploads.
  const done = useRef<{ projectId?: string; videos?: boolean; audio?: boolean; template?: boolean; brand?: boolean }>({});


  const busy = step !== "idle";
  const needsMusic = audioMode === "music";
  const usesMusic = audioMode === "music" || audioMode === "voice_music"; // the song plays in these modes, so its part matters
  const canSubmit = name.trim().length > 0 && videos.length > 0 && (audio !== null || !needsMusic) && !busy;

  // Arriving from "Use template": adjust state during render, once the templates have loaded.
  const wantedTemplate = useSearchParams().get("template");
  const [appliedFor, setAppliedFor] = useState<string | null>(null);
  const fromLink = wantedTemplate ? templates.data?.find((x) => x.id === wantedTemplate) : undefined;
  if (fromLink && appliedFor !== wantedTemplate) {
    setAppliedFor(wantedTemplate);
    setTemplateId(fromLink.id);
    applyTemplate(fromLink);
  }

  function applyTemplate(t: Template) {
    setDuration(t.duration);
    setStyle(t.style);
    setPace(t.pace);
    setCaptions(t.captions);
    setCaptionStyle(t.captionStyle);
    setAudioMode(t.audioMode as AudioModeId);
    setLanguage(t.language);
    setAi(t.ai);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    try {
      if (!done.current.projectId) {
        setStep("creating");
        const p = await api.createProject(name.trim(), { duration, style, pace, sequence, ...(sequence === "steps" ? { teaser, stepLabels, orderMode } : {}), captions: FEATURES.captions && captions, captionStyle, ai: FEATURES.ai && ai, aiDirector, audioMode, language, brief: brief.trim(), reference, platform, ...(platform === "instagram" ? { exportPreset: "instagram_reel", hookText: hookText.trim(), ctaText: ctaText.trim() } : {}), ...(trendId ? { trendId } : {}), ...(audio && usesMusic && audioStart !== null ? { audioStart } : {}) });
        done.current.projectId = p.id;
      }
      const id = done.current.projectId;
      if (!done.current.videos) {
        setStep("videos");
        setUploadPct(0);
        const res = await api.uploadVideos(id, videos.map((v) => v.file), setUploadPct);
        if (res.failed.length) {
          const names = res.failed.map((f) => `${f.name}: ${f.error.message}`).join("; ");
          setNotice(`Some clips were skipped — ${names}`);
        }
        done.current.videos = true;
      }
      if (audio && !done.current.audio) {
        setStep("audio");
        setUploadPct(0);
        await api.uploadAudio(id, audio, setUploadPct);
        done.current.audio = true;
      }
      if (templateId && !done.current.template) {
        await api.applyTemplate(id, templateId);
        done.current.template = true;
      }
      if (brandId && !done.current.brand) {
        await api.applyBrand(id, brandId);
        done.current.brand = true;
      }
      setStep("starting");
      await api.generate(id);
      await qc.invalidateQueries({ queryKey: ["projects"] });
      router.push(`/projects/${id}`);
    } catch (err) {
      setError({ message: errorMessage(err), code: (err as { code?: string }).code });
      setStep("idle");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-8" aria-label="Create Reel">
      <section>
        <label htmlFor="project-name" className="mb-1.5 block text-sm font-medium">
          Project name
        </label>
        <input
          id="project-name"
          value={name}
          maxLength={120}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Namora Luxury Reel"
          className="w-full rounded-xl border border-border bg-surface px-3 py-2 outline-none focus:border-accent"
        />
      </section>

      <section className="space-y-3" aria-label="Social media">
        <h2 className="text-sm font-medium">Where will you post it?</h2>
        <div role="radiogroup" aria-label="Social media" className="grid gap-2 sm:grid-cols-2">
          {PLATFORMS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={platform === p.id}
              disabled={busy}
              onClick={() => setPlatform(p.id)}
              className={`rounded-xl border px-4 py-3 text-left ${platform === p.id ? "border-accent bg-accent/15" : "border-border bg-surface hover:border-accent/50"}`}
            >
              <span className="block text-sm font-medium">{p.label}</span>
              <span className="block text-xs text-muted">{p.hint}</span>
            </button>
          ))}
        </div>
        {platform === "instagram" && (
          <Card className="space-y-4">
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted" aria-label="What Instagram mode does">
              {INSTAGRAM_RULES.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1.5 block font-medium">Hook text <span className="font-normal text-muted">(recommended)</span></span>
                <input
                  aria-label="Hook text"
                  value={hookText}
                  maxLength={66}
                  disabled={busy}
                  onChange={(e) => setHookText(e.target.value)}
                  placeholder="e.g. 3 mistakes every new runner makes"
                  className="w-full rounded-xl border border-border bg-surface px-3 py-2 outline-none focus:border-accent"
                />
                <span className="mt-1 block text-xs text-muted">The first words on screen: a question or a promise. Short works best (up to 7 words); longer text wraps onto more lines.</span>
              </label>
              <label className="block text-sm">
                <span className="mb-1.5 block font-medium">Closing line <span className="font-normal text-muted">(optional)</span></span>
                <input
                  aria-label="Closing line"
                  value={ctaText}
                  maxLength={66}
                  disabled={busy}
                  onChange={(e) => setCtaText(e.target.value)}
                  placeholder="e.g. Save this for your next run"
                  className="w-full rounded-xl border border-border bg-surface px-3 py-2 outline-none focus:border-accent"
                />
                <span className="mt-1 block text-xs text-muted">Shown on the last 2 seconds.</span>
              </label>
            </div>
            <p className="text-xs text-muted">
              Tip: in the instructions below, say who the Reel is for and the one thing it shows. Reels made for a specific person get
              sent to them, and sends are what Instagram uses most to reach new people.
            </p>
          </Card>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Videos</h2>
        <Dropzone
          label="Drag & drop your clips here"
          hint="MP4, MOV, M4V, WEBM, MKV, AVI · up to 500 MB each"
          accept={PICKER_VIDEO}
          multiple
          disabled={busy}
          validate={isVideoFile}
          onReject={(n) => setError({ message: `Unsupported video file: ${n.join(", ")}`, code: "UNSUPPORTED_MEDIA" })}
          onFiles={(files) => {
            setError(null);
            setVideos((cur) => [...cur, ...files.map((file) => ({ key: `v${++keySeq}`, file }))]);
          }}
        />
        <VideoList items={videos} onChange={setVideos} disabled={busy} />
        <h3 className="pt-2 text-sm font-medium">How should the clips be used?</h3>
        <SequenceSelector value={sequence} onChange={setSequence} disabled={busy} />
        {sequence === "steps" && <StepOptions teaser={teaser} stepLabels={stepLabels} onTeaser={setTeaser} onStepLabels={setStepLabels} disabled={busy} />}
        {sequence === "steps" && (
          <>
            <h3 className="pt-1 text-sm font-medium">Clip order</h3>
            <OrderModeSelector value={orderMode} onChange={setOrderMode} disabled={busy} />
            <p className="text-xs text-muted">
              {orderMode === "auto"
                ? "Clips follow the time in their file names (WhatsApp and phone names work); otherwise the order of the list above."
                : "Drag a clip above to any position, or use its ↑ / ↓ buttons, to set the exact order (1, 2, 3, …)."}{" "}
              The Reel is as long as the steps need, up to the length you choose.
            </p>
          </>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Duration</h2>
        <DurationSelector value={duration} onChange={setDuration} disabled={busy} />
        <p className="text-xs text-muted">Choose the length first: below, you pick which part of your song fits it.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">
          Music {!needsMusic && <span className="font-normal text-muted">(optional for this audio mode)</span>}
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
            {usesMusic ? (
              <AudioRangePicker bare source={audio} duration={duration} start={audioStart} onChange={setAudioStart} />
            ) : (
              <p className="border-t border-border pt-3 text-xs text-muted">This audio mode does not use the song, so there is no part to choose.</p>
            )}
          </Card>
        ) : (
          <Dropzone
            label="Drop your song here"
            hint="MP3, WAV, M4A, AAC, OGG, FLAC"
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
        {!audio && (
          <SongPicker
            disabled={busy}
            onPick={(file) => {
              setError(null);
              setAudio(file);
            }}
          />
        )}
      </section>

      <section className="space-y-4" aria-label="Brand and instructions">
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Brand <span className="font-normal text-muted">(optional)</span></span>
          <select aria-label="Brand" value={brandId} disabled={busy} onChange={(e) => setBrandId(e.target.value)} className={SELECT}>
            <option value="">None</option>
            {brands.data?.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </label>
        <div className="space-y-2">
          <label htmlFor="ai-instructions" className="block text-sm font-medium">
            Tell the AI what you want <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id="ai-instructions"
            aria-label="Instructions for the AI"
            value={brief}
            maxLength={1000}
            rows={4}
            disabled={busy}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="e.g. Luxury gold necklace collection. Slow and elegant, lots of close-ups of the details, end on the full look. Add text: New Collection."
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 outline-none focus:border-accent"
          />
          <div className="flex flex-wrap gap-2" aria-label="Instruction ideas">
            {INSTRUCTION_IDEAS.map((idea) => (
              <button
                key={idea}
                type="button"
                disabled={busy || brief.length + idea.length > 998}
                onClick={() => setBrief((b) => (b.trim() ? `${b.trim().replace(/[.,;]?$/, ".")} ${idea}` : idea))}
                className="rounded-full border border-border px-3 py-1 text-xs text-muted hover:border-accent/50 hover:text-foreground disabled:opacity-50"
              >
                + {idea}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted">
            The AI reads this together with your clips and song, and decides the style, pace, colour, shots, effects and text. After the
            Reel is made you can keep changing it with words.
          </p>
        </div>
      </section>

      {learned.data && learned.data.length > 0 && (
        <section className="space-y-2">
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">Edit like</span>
            <select aria-label="Edit like" value={reference} disabled={busy} onChange={(e) => setReference(e.target.value)} className={SELECT}>
              <option value="auto">AI picks from my trends</option>
              {learned.data.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
              <option value="none">None (the AI decides freely)</option>
            </select>
          </label>
          <p className="text-xs text-muted">Your trends are learned from trending Reels you uploaded (My trends). The AI copies their rhythm and feel.</p>
        </section>
      )}

      <details className="group rounded-xl border border-border bg-surface/50 px-4 py-3">
        <summary className="cursor-pointer select-none text-sm font-medium">
          Advanced <span className="font-normal text-muted">(optional: the AI decides these unless you set them)</span>
        </summary>
        <div className="mt-4 space-y-8">
          <section className="grid gap-4 sm:grid-cols-2" aria-label="Reel setup">
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Start from a template <span className="font-normal text-muted">(optional)</span></span>
          <select
            aria-label="Template"
            value={templateId}
            disabled={busy}
            onChange={(e) => {
              setTemplateId(e.target.value);
              const t = templates.data?.find((x) => x.id === e.target.value);
              if (t) applyTemplate(t);
            }}
            className={SELECT}
          >
            <option value="">None</option>
            {templates.data?.map((t) => (
              <option key={t.id} value={t.id}>{t.favorite ? "★ " : ""}{t.name}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Audio</span>
          <select aria-label="Audio mode" value={audioMode} disabled={busy} onChange={(e) => setAudioMode(e.target.value as AudioModeId)} className={SELECT}>
            {AUDIO_MODES.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          {(audioMode === "voice" || audioMode === "voice_music") && (
            <span className="mt-1 block text-xs text-muted">Write the script and generate the voice in the editor after the first render.</span>
          )}
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Language</span>
          <select aria-label="Language" value={language} disabled={busy} onChange={(e) => setLanguage(e.target.value as Language)} className={SELECT}>
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
        </label>
          </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Pace</h2>
        <PaceSelector withAuto value={pace} onChange={setPace} disabled={busy} />
        <p className="text-xs text-muted">How quickly the edit cuts. &quot;AI decides&quot; follows your instructions and the music.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Style</h2>
        <StyleSelector value={style} onChange={setStyle} disabled={busy} />
      </section>

      {trends.data && trends.data.length > 0 && (
        <section className="space-y-2">
          <label htmlFor="trend" className="block text-sm font-medium">
            Trend preset <span className="font-normal text-muted">(optional)</span>
          </label>
          <select
            id="trend"
            value={trendId}
            disabled={busy}
            onChange={(e) => {
              const id = e.target.value;
              setTrendId(id);
              const t = trends.data?.find((x) => x.id === id);
              if (t) {
                if ([15, 30, 60].includes(t.recommendedDuration)) setDuration(t.recommendedDuration);
                setCaptionStyle(t.captionStyle);
              }
            }}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 outline-none focus:border-accent sm:w-auto"
          >
            <option value="">None</option>
            {trends.data.map((t) => (
              <option key={t.id} value={t.id}>
                {t.trendName}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted">Overrides the style&apos;s cut pacing and transitions, and pre-fills duration and captions.</p>
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-2">
        {[
          { id: "captions", label: "Captions", value: captions, set: setCaptions, on: FEATURES.captions, todo: "Not available yet (Phase 9)", hint: "" },
          {
            id: "ai",
            label: "AI assist",
            value: ai,
            set: setAi,
            on: FEATURES.ai,
            todo: "Not available yet (Phase 10)",
            hint: "Looks at every clip before choosing shots (which is good, what it shows, the best order) instead of guessing from file names. With a cloud AI (Gemini/OpenAI) this takes seconds; a local model can take a few minutes per clip — turn it off for a fast draft.",
          },
          {
            id: "aiDirector",
            label: "AI director",
            value: aiDirector,
            set: setAiDirector,
            on: FEATURES.ai && ai,
            todo: "Needs AI assist",
            hint: "The AI plans every shot — which moment, where to cut on the beat, effect, transition, text and colour — and the app checks every choice before editing. Off: the built-in editor cuts, the AI only helps.",
          },
        ].map((t) => (
          <label
            key={t.id}
            className={`flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3 ${t.on ? "" : "opacity-60"}`}
          >
            <span>
              <span className="block text-sm font-medium">{t.label}</span>
              {!t.on ? <span className="block text-xs text-muted">{t.todo}</span> : t.value && t.hint ? <span className="block max-w-xs text-xs text-muted">{t.hint}</span> : null}
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={t.on && t.value}
              disabled={!t.on || busy}
              onChange={(e) => t.set(e.target.checked)}
              className="h-5 w-5 accent-[var(--accent)]"
            />
          </label>
        ))}
      </section>

      {FEATURES.captions && captions && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Caption style</h2>
          <div role="radiogroup" aria-label="Caption style" className="flex flex-wrap gap-2">
            {CAPTION_STYLES.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={captionStyle === c}
                disabled={busy}
                onClick={() => setCaptionStyle(c)}
                className={`rounded-full border px-3 py-1 text-sm capitalize ${
                  captionStyle === c ? "border-accent bg-accent/15" : "border-border text-muted hover:text-foreground"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted">
            Captions transcribe the lyrics or speech in your music track (the first run downloads the speech model).
          </p>
        </section>
      )}
        </div>
      </details>

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
            {(step === "videos" || step === "audio") && <ProgressBar value={uploadPct * 100} label="Upload progress" />}
          </div>
        )}
        <button type="submit" disabled={!canSubmit} className={`${btnPrimary} w-full py-3 text-base sm:w-auto`}>
          {busy ? "Working…" : "Generate Reel"}
        </button>
        {!canSubmit && !busy && (
          <p className="text-xs text-muted">{needsMusic ? "Add a name, at least one video and a song to continue." : "Add a name and at least one video to continue."}</p>
        )}
      </div>
    </form>
  );
}
