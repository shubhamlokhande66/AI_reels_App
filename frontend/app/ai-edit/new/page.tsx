"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AudioRangePicker } from "@/components/AudioRangePicker";
import { Dropzone } from "@/components/Dropzone";
import { ProgressBar } from "@/components/ProgressStages";
import { DurationSelector } from "@/components/StyleSelector";
import { btnPrimary, btnSecondary, Card, ErrorBanner, PageHeader } from "@/components/ui";
import { VideoList, type LocalVideo } from "@/components/VideoList";
import { api, errorMessage } from "@/lib/api";
import { PICKER_AUDIO, PICKER_VIDEO, formatBytes, isAudioFile, isVideoFile } from "@/lib/format";

const IDEAS = ["Make it calmer with longer shots", "Faster cuts, more energy", "Add captions", "Louder music", "Smoother transitions"];

/**
 * A fresh, standalone way in: give it video + audio, describe what you want in your own words, and it makes a first
 * Reel, then applies your prompt as a real edit — the same "Change this Reel" the project page already has, just
 * asked up front. A brand new page; it does not change Create Reel, Beat Sync or the editor.
 */
export default function NewAiEditPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [duration, setDuration] = useState(30);
  const [videos, setVideos] = useState<LocalVideo[]>([]);
  const [audio, setAudio] = useState<File | null>(null);
  const [audioStart, setAudioStart] = useState<number | null>(null); // null = the app picks the best part of the song
  const [prompt, setPrompt] = useState("");
  const [step, setStep] = useState<"idle" | "creating" | "videos" | "audio" | "generating">("idle");
  const [pct, setPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  let seq = 0;

  const busy = step !== "idle";
  const canSubmit = videos.length > 0 && !!audio && !busy;
  const add = (idea: string) => setPrompt((t) => (t.trim() ? `${t.trim().replace(/[.,]$/, "")}, ${idea.toLowerCase()}` : idea));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !audio) return;
    setError(null);
    try {
      setStep("creating");
      const project = await api.createProject(name.trim() || "AI edit", {
        duration,
        style: "fast_trending",
        sequence: "mixed",
        ai: false,
        ...(audioStart !== null ? { audioStart } : {}),
      });

      setStep("videos");
      setPct(0);
      const res = await api.uploadVideos(project.id, videos.map((v) => v.file), setPct);
      if (res.uploaded.length === 0) throw new Error("None of the video clips could be used.");

      setStep("audio");
      setPct(0);
      await api.uploadAudio(project.id, audio, setPct);

      setStep("generating");
      await api.generate(project.id, { label: "AI edit" });
      await qc.invalidateQueries({ queryKey: ["projects"] });
      const p = prompt.trim();
      router.push(`/projects/${project.id}${p ? `?prompt=${encodeURIComponent(p)}` : ""}`);
    } catch (err) {
      setError(errorMessage(err));
      setStep("idle");
    }
  }

  return (
    <>
      <PageHeader
        title="AI Edit"
        subtitle="Drop in your clips and a song, say what you want in your own words, and it builds a Reel and then applies your prompt as a real edit."
      />

      <form onSubmit={submit} className="max-w-2xl space-y-6">
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">
            Name <span className="font-normal text-muted">(optional)</span>
          </span>
          <input
            value={name}
            maxLength={120}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            placeholder="AI edit"
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 outline-none focus:border-accent"
          />
        </label>

        <section className="space-y-3">
          <h2 className="text-sm font-medium">Duration</h2>
          <DurationSelector value={duration} onChange={setDuration} disabled={busy} />
          <p className="text-xs text-muted">Choose the length first: below, you pick which part of your song fits it.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium">Video clips</h2>
          <Dropzone
            label="Drag & drop your video clips here"
            hint="MP4, MOV, M4V, WEBM, MKV, AVI"
            accept={PICKER_VIDEO}
            multiple
            disabled={busy}
            validate={isVideoFile}
            onReject={(n) => setError(`Unsupported video file: ${n.join(", ")}`)}
            onFiles={(files) => {
              setError(null);
              setVideos((cur) => [...cur, ...files.map((file) => ({ key: `v${++seq}`, file }))]);
            }}
          />
          <VideoList items={videos} onChange={setVideos} disabled={busy} />
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium">Song</h2>
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
              hint="MP3, WAV, M4A, AAC, OGG, FLAC"
              accept={PICKER_AUDIO}
              disabled={busy}
              validate={isAudioFile}
              onReject={(n) => setError(`Unsupported audio file: ${n.join(", ")}`)}
              onFiles={(files) => {
                setError(null);
                setAudio(files[0]);
              }}
            />
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium">
            Tell the AI what to do <span className="font-normal text-muted">(optional)</span>
          </h2>
          <textarea
            aria-label="What should the AI do?"
            rows={3}
            maxLength={3000}
            value={prompt}
            disabled={busy}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. Make it calmer, remove the first clip, add captions and make the music louder"
            className="w-full resize-y rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60"
          />
          <div className="flex flex-wrap gap-2" aria-label="Ideas">
            {IDEAS.map((i) => (
              <button
                key={i}
                type="button"
                disabled={busy}
                onClick={() => add(i)}
                className="rounded-full border border-border px-2.5 py-1 text-xs text-muted hover:border-accent/60 hover:text-foreground disabled:opacity-50"
              >
                {i}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted">
            First it builds a plain Reel from your clips and beats, then it applies this as a real edit — same as the &quot;Change this Reel&quot; box on
            any project, just asked up front. If the AI has to interpret part of it, you&apos;ll see exactly what it understood and confirm before anything
            changes.
          </p>
          <p className="text-xs text-muted">
            This edits your own uploaded clips — trim, speed, order, transitions, captions, music, style. It does not generate new video or
            animate a photo (no AI video/image generation is built in), so a long creative-direction brief mostly won&apos;t be understood; short,
            direct instructions work best.
          </p>
        </section>

        {error && <ErrorBanner message={error} />}

        <div className="space-y-3">
          {busy && (
            <div aria-live="polite">
              <p className="mb-1 text-sm text-muted">
                {step === "creating" && "Creating…"}
                {step === "videos" && "Uploading video…"}
                {step === "audio" && "Uploading song…"}
                {step === "generating" && "Building your Reel…"}
              </p>
              {(step === "videos" || step === "audio") && <ProgressBar value={pct * 100} label="Upload progress" showEta />}
            </div>
          )}
          <button type="submit" disabled={!canSubmit} className={`${btnPrimary} w-full py-3 text-base sm:w-auto`}>
            {busy ? "Working…" : "Create and edit with AI"}
          </button>
          {!canSubmit && !busy && <p className="text-xs text-muted">Add at least one video clip and a song to continue.</p>}
        </div>
      </form>
    </>
  );
}
