"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { keys } from "@/hooks/useApi";
import { api, assetUrl, errorMessage } from "@/lib/api";
import { PICKER_AUDIO, formatBytes, formatDuration, isAudioFile } from "@/lib/format";
import { AudioRangePicker } from "./AudioRangePicker";
import { ClipOrderList } from "./ClipOrderList";
import { Dropzone } from "./Dropzone";
import { OrderModeSelector, SequenceSelector, StepOptions } from "./StyleSelector";
import { LANGUAGES, type Language, type PerformanceInput, type Project, type Rendering, type Sequence } from "@/types/api";
import { btnPrimary, btnSecondary, Card, ErrorBanner } from "./ui";

/** Analyse content, create variations, duplicate / language variant. */
export function ProjectTools({ project, busy }: { project: Project; busy: boolean }) {
  const router = useRouter();
  const qc = useQueryClient();
  const strategies = useQuery({ queryKey: ["strategies"], queryFn: api.strategies });
  const [picked, setPicked] = useState<string[] | null>(null); // null = the first three strategies
  const [language, setLanguage] = useState<Language>(project.settings.language === "hi" ? "en" : "hi");

  const refresh = () => qc.invalidateQueries({ queryKey: keys.project(project.id) });
  const understand = useMutation({ mutationFn: () => api.understand(project.id), onSuccess: refresh });
  const chosen = picked ?? strategies.data?.slice(0, 3).map((s) => s.id) ?? [];
  const variations = useMutation({ mutationFn: () => api.variations(project.id, chosen), onSuccess: refresh });
  const [start, setStart] = useState<number | null>(project.settings.audioStart ?? null);
  const part = useMutation({
    mutationFn: () =>
      api.generate(project.id, start === null ? { audioAuto: true, label: "Song part: automatic" } : { audioStart: start, label: `Song part from ${formatDuration(start)}` }),
    onSuccess: refresh,
  });
  const [songError, setSongError] = useState<string | null>(null);
  const changeSong = useMutation({
    mutationFn: async (file: File) => {
      await api.uploadAudio(project.id, file);
      return api.generate(project.id, { audioAuto: true, label: `Song changed: ${file.name}` });
    },
    onSuccess: () => {
      setStart(null);
      refresh();
    },
  });
  const [sequence, setSequence] = useState<Sequence>(project.settings.sequence ?? "mixed");
  const [teaser, setTeaser] = useState(project.settings.teaser ?? true);
  const [stepLabels, setStepLabels] = useState(project.settings.stepLabels ?? true);
  const [orderMode, setOrderMode] = useState<"auto" | "manual">(project.settings.orderMode ?? "auto");
  const [clipOrder, setClipOrder] = useState<string[]>(project.videos.map((v) => v.id));
  const order = useMutation({
    mutationFn: async () => {
      if (sequence === "steps" && orderMode === "manual") await api.reorderVideos(project.id, clipOrder);
      return api.generate(project.id, { sequence, ...(sequence === "steps" ? { teaser, stepLabels, orderMode } : {}), label: sequence === "steps" ? "Step by step" : "Best moments" });
    },
    onSuccess: refresh,
  });
  const copy = useMutation({
    mutationFn: (variant: "copy" | "language") => api.duplicate(project.id, variant === "language" ? { variant, language } : { variant }),
    onSuccess: (r) => router.push(`/projects/${r.id}`),
  });

  const hasFootage = project.videos.length > 0;
  const hasSound = !!project.audio || (project.settings.audioMode ?? "music") !== "music";
  const error = understand.error ?? variations.error ?? copy.error ?? part.error ?? order.error ?? changeSong.error;
  const toggle = (id: string) => setPicked(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);

  return (
    <section className="mt-10 space-y-4" aria-label="Project tools">
      <h2 className="text-lg font-semibold">Tools</h2>
      {error && <ErrorBanner message={errorMessage(error)} />}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="space-y-3">
          <h3 className="font-medium">Understand the footage</h3>
          <p className="text-sm text-muted">
            Uses the local vision model to describe each clip (scene, objects, mood). This powers smarter shot choice and Library search. It can take about 20 seconds per clip.
          </p>
          <button type="button" className={btnSecondary} disabled={busy || understand.isPending || !hasFootage} onClick={() => understand.mutate()}>
            {understand.isPending ? "Starting…" : "Analyse content"}
          </button>
        </Card>

        {hasFootage && (
          <Card className="space-y-3 md:col-span-2">
            <h3 className="font-medium">Clip order</h3>
            <p className="text-sm text-muted">
              Cooking or a tutorial? Choose <em>Step by step</em> to keep your clips in the order they happened. It follows the time in the file names, otherwise your clip list; the last clip is the finale.
            </p>
            <SequenceSelector value={sequence} onChange={setSequence} disabled={busy || order.isPending} />
            {sequence === "steps" && <StepOptions teaser={teaser} stepLabels={stepLabels} onTeaser={setTeaser} onStepLabels={setStepLabels} disabled={busy || order.isPending} />}
            {sequence === "steps" && (
              <>
                <h4 className="pt-1 text-sm font-medium">Clip order</h4>
                <OrderModeSelector value={orderMode} onChange={setOrderMode} disabled={busy || order.isPending} />
                {orderMode === "manual" && (
                  <ClipOrderList videos={project.videos} order={clipOrder} onChange={setClipOrder} disabled={busy || order.isPending} />
                )}
              </>
            )}
            <button
              type="button"
              className={btnPrimary}
              disabled={
                busy ||
                order.isPending ||
                (sequence === (project.settings.sequence ?? "mixed") &&
                  (sequence === "mixed" ||
                    (teaser === (project.settings.teaser ?? true) &&
                      stepLabels === (project.settings.stepLabels ?? true) &&
                      orderMode === (project.settings.orderMode ?? "auto") &&
                      (orderMode === "auto" || clipOrder.join() === project.videos.map((v) => v.id).join()))))
              }
              onClick={() => order.mutate()}
            >
              {order.isPending ? "Starting…" : "Make a new version"}
            </button>
          </Card>
        )}

        <Card className="space-y-3">
          <h3 className="font-medium">Copies</h3>
          <p className="text-sm text-muted">Duplicate this project without uploading again, or make a version in another language.</p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={btnSecondary} disabled={copy.isPending} onClick={() => copy.mutate("copy")}>
              Duplicate
            </button>
            <select
              aria-label="Variant language"
              value={language}
              onChange={(e) => setLanguage(e.target.value as Language)}
              className="rounded-lg border border-border bg-surface px-2 py-2 text-sm"
            >
              {LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
            <button type="button" className={btnSecondary} disabled={copy.isPending} onClick={() => copy.mutate("language")}>
              Language variant
            </button>
          </div>
        </Card>

        <Card className="space-y-3 md:col-span-2">
          <h3 className="font-medium">Music</h3>
          {project.audio ? (
            <p className="text-sm text-muted">
              Current song: <span className="text-foreground">{project.audio.name}</span> · {formatDuration(project.audio.duration)} · {formatBytes(project.audio.size)}
            </p>
          ) : (
            <p className="text-sm text-muted">No song yet.</p>
          )}
          {songError && <ErrorBanner message={songError} />}
          <Dropzone
            label={project.audio ? "Drop a different song here to replace it" : "Drop a song here"}
            hint="Replacing the song makes a new version with the best part of it automatically chosen; your earlier versions are kept."
            accept={PICKER_AUDIO}
            disabled={busy || changeSong.isPending}
            validate={isAudioFile}
            onReject={() => setSongError("That doesn't look like an audio file.")}
            onFiles={(files) => {
              setSongError(null);
              changeSong.mutate(files[0]);
            }}
          />
          {changeSong.isPending && <p className="text-sm text-muted">Uploading and directing with the new song…</p>}
        </Card>

        {project.audio && (project.settings.audioMode ?? "music") !== "none" && (
          <Card className="space-y-3 md:col-span-2">
            <h3 className="font-medium">Part of the song</h3>
            <p className="text-sm text-muted">
              Choose which {formatDuration(project.settings.duration)} of the song the Reel uses. It is re-cut to the beats of that part and saved as a new version.
            </p>
            <AudioRangePicker source={assetUrl(project.audio.url) ?? ""} duration={project.settings.duration} start={start} onChange={setStart} />
            <button type="button" className={btnPrimary} disabled={busy || part.isPending || !hasFootage} onClick={() => part.mutate()}>
              {part.isPending ? "Starting…" : "Regenerate with this part"}
            </button>
          </Card>
        )}

        <Card className="space-y-3 md:col-span-2">
          <h3 className="font-medium">Variations</h3>
          <p className="text-sm text-muted">Render several versions of the same Reel with different editing strategies, then pick the one you like.</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Variation strategies">
            {strategies.data?.map((s) => (
              <label
                key={s.id}
                title={s.description}
                className={`cursor-pointer rounded-full border px-3 py-1 text-sm ${chosen.includes(s.id) ? "border-accent bg-accent/15" : "border-border text-muted"}`}
              >
                <input type="checkbox" className="sr-only" checked={chosen.includes(s.id)} onChange={() => toggle(s.id)} />
                {s.label}
              </label>
            ))}
          </div>
          <button
            type="button"
            className={btnPrimary}
            disabled={busy || variations.isPending || !hasFootage || !hasSound || chosen.length === 0}
            onClick={() => variations.mutate()}
          >
            {variations.isPending ? "Starting…" : `Create ${chosen.length} variation${chosen.length === 1 ? "" : "s"}`}
          </button>
        </Card>
      </div>
    </section>
  );
}

const NUM = "w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent";
const BLANK: PerformanceInput = { platform: "instagram", views: 0, watchSeconds: 0, likes: 0, shares: 0, saves: 0, comments: 0, completionRate: null };

/** The user types in numbers from the platform. Nothing is fetched or predicted. */
export function PerformanceForm({ rendering }: { rendering: Rendering }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<PerformanceInput>(rendering.performance ?? BLANK);
  const save = useMutation({
    mutationFn: () => api.performance(rendering.projectId, rendering.id, v),
    onSuccess: () => {
      setOpen(false);
      qc.invalidateQueries({ queryKey: keys.project(rendering.projectId) });
      qc.invalidateQueries({ queryKey: keys.renderings(rendering.projectId) });
      qc.invalidateQueries({ queryKey: ["insights"] });
    },
  });
  const num = (k: "views" | "likes" | "shares" | "saves" | "comments", label: string) => (
    <label className="text-xs text-muted">
      {label}
      <input type="number" min={0} className={NUM} value={v[k]} onChange={(e) => setV({ ...v, [k]: Math.max(0, Number(e.target.value) || 0) })} />
    </label>
  );
  if (!open) {
    return (
      <button type="button" className="text-xs text-accent hover:underline" onClick={() => setOpen(true)}>
        {rendering.performance ? `Results: ${rendering.performance.views} views · edit` : "Add posting results"}
      </button>
    );
  }
  return (
    <form
      aria-label="Posting results"
      className="mt-2 space-y-2 rounded-xl border border-border bg-surface-2 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <p className="text-xs text-muted">Copy the numbers from the platform. They are only used for your own insights.</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2 text-xs text-muted">
          Platform
          <select className={NUM} value={v.platform} onChange={(e) => setV({ ...v, platform: e.target.value as PerformanceInput["platform"] })}>
            {["instagram", "youtube", "tiktok", "other"].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        {num("views", "Views")}
        {num("likes", "Likes")}
        {num("shares", "Shares")}
        {num("saves", "Saves")}
        {num("comments", "Comments")}
        <label className="text-xs text-muted">
          Completion %
          <input
            type="number"
            min={0}
            max={100}
            className={NUM}
            placeholder="optional"
            value={v.completionRate === null ? "" : Math.round(v.completionRate * 100)}
            onChange={(e) => setV({ ...v, completionRate: e.target.value === "" ? null : Math.min(100, Math.max(0, Number(e.target.value))) / 100 })}
          />
        </label>
      </div>
      {save.error && <ErrorBanner message={errorMessage(save.error)} />}
      <div className="flex gap-2">
        <button type="submit" className={btnPrimary} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </button>
        <button type="button" className={btnSecondary} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
