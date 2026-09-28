"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AudioRangePicker } from "@/components/AudioRangePicker";
import { Dropzone } from "@/components/Dropzone";
import { ProgressBar } from "@/components/ProgressStages";
import { DurationSelector, PaceSelector, type PaceId } from "@/components/StyleSelector";
import { btnPrimary, btnSecondary, Card, ErrorBanner, PageHeader } from "@/components/ui";
import { VideoList, type LocalVideo } from "@/components/VideoList";
import { api, errorMessage } from "@/lib/api";
import { PICKER_AUDIO, PICKER_VIDEO, formatBytes, isAudioFile, isVideoFile } from "@/lib/format";

/**
 * A fresh, standalone way in: give it video + audio right here, and it goes straight to the beat-sync check —
 * no need to go through the full Create Reel form first. A brand new page; it does not change Create Reel or the editor.
 */
export default function NewBeatSyncPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [duration, setDuration] = useState(30);
  const [videos, setVideos] = useState<LocalVideo[]>([]);
  const [audio, setAudio] = useState<File | null>(null);
  const [audioStart, setAudioStart] = useState<number | null>(null); // null = the app picks the best part of the song
  const [pace, setPace] = useState<PaceId>("balanced"); // calm = fewer, longer cuts (still snapped to strong beats when close); fast = a cut on every beat
  const [step, setStep] = useState<"idle" | "creating" | "videos" | "audio" | "checking">("idle");
  const [pct, setPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  let seq = 0;

  const busy = step !== "idle";
  const canSubmit = videos.length > 0 && !!audio && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !audio) return;
    setError(null);
    try {
      setStep("creating");
      const project = await api.createProject(name.trim() || "Beat sync check", {
        duration,
        style: "fast_trending",
        pace,
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

      setStep("checking");
      await api.generate(project.id, { label: "Beat sync check" });
      await qc.invalidateQueries({ queryKey: ["projects"] });
      router.push(`/projects/${project.id}/beats`);
    } catch (err) {
      setError(errorMessage(err));
      setStep("idle");
    }
  }

  return (
    <>
      <PageHeader title="Check the beat sync" subtitle="Drop in your clips and a song. It splits the video on the music's beats, then shows you the result — nothing else." />

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
            placeholder="Beat sync check"
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
              hint="Every cut is checked against this song's beats"
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
          <h2 className="text-sm font-medium">Cut rhythm</h2>
          <PaceSelector value={pace} onChange={setPace} disabled={busy} />
          <p className="text-xs text-muted">
            Calm cuts less often (still lands on a strong beat nearby when there is one) · Fast cuts on every beat, even weak ones.
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
                {step === "checking" && "Splitting on the beat…"}
              </p>
              {(step === "videos" || step === "audio") && <ProgressBar value={pct * 100} label="Upload progress" />}
            </div>
          )}
          <button type="submit" disabled={!canSubmit} className={`${btnPrimary} w-full py-3 text-base sm:w-auto`}>
            {busy ? "Working…" : "Check the beat sync"}
          </button>
          {!canSubmit && !busy && <p className="text-xs text-muted">Add at least one video clip and a song to continue.</p>}
        </div>
      </form>
    </>
  );
}
