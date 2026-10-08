"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, assetUrl, errorMessage } from "@/lib/api";
import { keys } from "@/hooks/useApi";
import { MAX_AUDIO_MB, tooBig } from "@/lib/format";
import type { PictureSource, Project, Story } from "@/types/api";
import { ProgressStages } from "./ProgressStages";
import { PublishPanel } from "./PublishPanel";
import { ReferenceReel } from "./ReferenceReel";
import { btnPrimary, btnSecondary, Card, ErrorBanner, PageHeader, Spinner } from "./ui";

const SOURCE: Record<PictureSource, string> = {
  library: "From the library · free",
  public_domain: "Classical painting · free",
  free_ai: "AI picture · free",
  paid_ai: "AI picture",
  upload: "Your picture",
};

type Draft = { id: string; narration: string; visual: string };

/** A story project: the scenes (text + picture), the narrator, and the finished Reel. */
export function StoryStudio({ project }: { project: Project }) {
  const qc = useQueryClient();
  const pid = project.id;
  const story = useQuery({ queryKey: ["story", pid], queryFn: () => api.getStory(pid) });
  const options = useQuery({ queryKey: ["story-options"], queryFn: api.storyOptions, staleTime: 300_000 });
  const [title, setTitle] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [busyScene, setBusyScene] = useState<string | null>(null);
  const [sceneErrors, setSceneErrors] = useState<Record<string, string>>({});
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  const [voice, setVoice] = useState<string>("gemini:Orus");
  const [error, setError] = useState<string | null>(null);
  const fileFor = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const musicInput = useRef<HTMLInputElement>(null);

  // the editable copy starts from the saved story (and again whenever the saved scene list changes shape)
  const data = story.data;
  const shape = data ? data.scenes.map((s) => s.id).join(",") : null;
  if (data && shape !== loadedFor) {
    setLoadedFor(shape);
    setTitle(data.title);
    setDrafts(data.scenes.map((s) => ({ id: s.id, narration: s.narration, visual: s.visual })));
  }
  const saved = data?.scenes ?? [];
  const dirty =
    !!data &&
    (title !== data.title ||
      drafts.length !== saved.length ||
      drafts.some((d, i) => d.id !== saved[i]?.id || d.narration !== saved[i]?.narration || d.visual !== saved[i]?.visual));

  const setStory = (s: Story) => qc.setQueryData(["story", pid], s);
  const save = useMutation({
    mutationFn: () => api.editStory(pid, { title, scenes: drafts }),
    onSuccess: (s) => {
      setStory(s);
      setLoadedFor(null); // re-read the saved copy (new scenes get their ids)
    },
  });

  async function ensureSaved(): Promise<boolean> {
    if (!dirty) return true;
    for (const d of drafts) if (!d.narration.trim()) return setError("Every scene needs a narration line (or delete the scene)."), false;
    if (drafts.length < 2) return setError("A story needs at least 2 scenes."), false;
    try {
      await save.mutateAsync();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    }
  }

  async function picture(sceneId: string, another: boolean) {
    setError(null);
    if (!(await ensureSaved())) return;
    setBusyScene(sceneId);
    setSceneErrors((m) => ({ ...m, [sceneId]: "" }));
    try {
      setStory(await api.scenePicture(pid, sceneId, another));
    } catch (e) {
      setSceneErrors((m) => ({ ...m, [sceneId]: errorMessage(e) }));
    } finally {
      setBusyScene(null);
    }
  }

  async function allPictures() {
    setError(null);
    if (!(await ensureSaved())) return;
    const fresh = qc.getQueryData<Story>(["story", pid]) ?? data;
    const todo = (fresh?.scenes ?? []).filter((s) => !s.imageUrl);
    setBatch({ done: 0, total: todo.length });
    for (const [i, s] of todo.entries()) {
      setBusyScene(s.id);
      try {
        setStory(await api.scenePicture(pid, s.id, false));
        setSceneErrors((m) => ({ ...m, [s.id]: "" }));
      } catch (e) {
        setSceneErrors((m) => ({ ...m, [s.id]: errorMessage(e) }));
      }
      setBatch({ done: i + 1, total: todo.length });
    }
    setBusyScene(null);
    setBatch(null);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    const sceneId = fileFor.current;
    e.target.value = "";
    if (!f || !sceneId) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return setSceneErrors((m) => ({ ...m, [sceneId]: "Use a JPG or PNG picture." }));
    if (f.size > 15 * 1024 * 1024) return setSceneErrors((m) => ({ ...m, [sceneId]: "The picture is larger than 15 MB." }));
    if (!(await ensureSaved())) return;
    setBusyScene(sceneId);
    try {
      setStory(await api.uploadScenePicture(pid, sceneId, f));
      setSceneErrors((m) => ({ ...m, [sceneId]: "" }));
    } catch (err) {
      setSceneErrors((m) => ({ ...m, [sceneId]: errorMessage(err) }));
    } finally {
      setBusyScene(null);
    }
  }

  const music = useMutation({
    mutationFn: (f: File) => api.uploadAudio(pid, f),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.project(pid) }),
  });
  async function onMusic(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (tooBig([f], MAX_AUDIO_MB).length) return setError(`The song is larger than ${MAX_AUDIO_MB} MB.`);
    music.mutate(f);
  }

  const replan = useMutation({
    mutationFn: () => api.replanStory(pid),
    onSuccess: (s) => {
      setStory(s);
      setLoadedFor(null);
    },
  });

  const render = useMutation({
    mutationFn: async (quality: "preview" | "final") => {
      if (!(await ensureSaved())) throw new Error("Save the scenes first.");
      return api.renderStory(pid, { voiceId: voice, quality });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.project(pid) }),
  });

  useEffect(() => {
    if (options.data && !options.data.narrators.some((n) => n.id === voice)) setVoice(options.data.narrators[0]?.id ?? "");
  }, [options.data, voice]);

  if (story.isLoading) return <Spinner label="Opening your story…" />;
  if (story.error || !data) return <ErrorBanner message={errorMessage(story.error ?? new Error("Story not found."))} />;

  const processing = project.status === "processing";
  const missing = saved.filter((s) => !s.imageUrl).length;
  const busy = processing || !!busyScene || !!batch || save.isPending;
  const newer = project.preview && (!project.output || project.preview.createdAt > project.output.createdAt);
  const shown = newer ? project.preview : project.output;
  const move = (i: number, d: -1 | 1) =>
    setDrafts((xs) => {
      const j = i + d;
      if (j < 0 || j >= xs.length) return xs;
      const c = [...xs];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });

  return (
    <>
      <PageHeader title={data.title} subtitle={`Story Reel · ${data.scenes.length} scenes`} />
      <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onFile} />
      <input ref={musicInput} type="file" accept="audio/*" hidden onChange={onMusic} />

      {processing && project.latestJob && (
        <Card className="mb-6">
          <ProgressStages job={project.latestJob} />
        </Card>
      )}

      {shown && !processing && (
        <section className="mb-8 grid gap-6 lg:grid-cols-[minmax(0,340px)_1fr]">
          <video key={shown.id} src={assetUrl(shown.url)} controls playsInline preload="metadata" className="aspect-[9/16] w-full rounded-2xl border border-border bg-black" aria-label="Story Reel" />
          <div className="space-y-4">
            <p className="text-sm text-muted">{newer ? "Quick preview (lower quality). Make the final Reel when you like it." : "Your Reel is ready."}</p>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <a href={assetUrl(shown.downloadUrl)} download className={`${btnPrimary} col-span-2`}>
                Download MP4
              </a>
            </div>
            {!newer && project.output && <PublishPanel projectId={pid} rendering={project.output} />}
          </div>
        </section>
      )}

      {data.plannedBy === "simple" && (
        <div className="mb-6 rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm">
          <p>
            The AI was busy, so the story was split into scenes sentence by sentence (no character looks or picture ideas). For
            better scenes and pictures, let the AI write them again.
          </p>
          {replan.error && <p className="mt-2 text-danger">{errorMessage(replan.error)}</p>}
          <button type="button" className={`${btnSecondary} mt-3`} disabled={busy || replan.isPending} onClick={() => replan.mutate()}>
            {replan.isPending ? "Writing the scenes…" : "Rewrite the scenes with AI"}
          </button>
        </div>
      )}

      <Card className="mb-6 space-y-3">
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Title (shown at the start)</span>
          <input
            value={title}
            maxLength={120}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 outline-none focus:border-accent"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={btnPrimary} disabled={busy || missing === 0} onClick={() => void allPictures()}>
            {batch ? `Getting pictures… ${batch.done}/${batch.total}` : missing ? `Get pictures for ${missing} scene${missing > 1 ? "s" : ""}` : "✓ Every scene has a picture"}
          </button>
          {dirty && (
            <button type="button" className={btnSecondary} disabled={busy} onClick={() => void ensureSaved()}>
              {save.isPending ? "Saving…" : "Save changes"}
            </button>
          )}
        </div>
        {batch && (
          <div className="lux-progress-track h-2 w-full">
            <div className="lux-progress-fill h-full" style={{ width: `${(100 * batch.done) / Math.max(batch.total, 1)}%` }} />
          </div>
        )}
        {error && <ErrorBanner message={error} />}
      </Card>

      <ol className="space-y-4">
        {drafts.map((d, i) => {
          const s = saved.find((x) => x.id === d.id);
          const working = busyScene === d.id;
          return (
            <li key={d.id}>
              <Card className="flex flex-col gap-4 sm:flex-row">
                <div className="mx-auto w-40 shrink-0 sm:mx-0">
                  <div className="relative aspect-[9/16] w-full overflow-hidden rounded-xl border border-border bg-surface-2">
                    {s?.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={assetUrl(s.imageUrl)} alt={`Scene ${i + 1}`} className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full place-items-center p-3 text-center text-xs text-muted">{working ? "Finding a picture…" : "No picture yet"}</div>
                    )}
                    {working && s?.imageUrl && <div className="absolute inset-0 grid place-items-center bg-black/50 text-xs text-white">Working…</div>}
                  </div>
                  {s?.source && <p className="mt-1.5 text-center text-[11px] text-accent">{SOURCE[s.source]}</p>}
                  {s?.credit && s.source === "public_domain" && <p className="text-center text-[10px] text-muted">{s.credit}</p>}
                  <div className="mt-2 grid gap-1.5">
                    <button type="button" className={`${btnSecondary} px-3 py-1.5 text-xs`} disabled={busy || !s} onClick={() => void picture(d.id, !!s?.imageUrl)}>
                      {s?.imageUrl ? "Another picture" : "Get a picture"}
                    </button>
                    <button
                      type="button"
                      className={`${btnSecondary} px-3 py-1.5 text-xs`}
                      disabled={busy || !s}
                      onClick={() => {
                        fileFor.current = d.id;
                        fileInput.current?.click();
                      }}
                    >
                      Upload my own
                    </button>
                  </div>
                </div>
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="lux-eyebrow">Scene {i + 1}{i === 0 ? " · hook" : ""}</p>
                    <div className="flex gap-1 text-sm">
                      <button type="button" aria-label="Move up" className="rounded-lg px-2 py-1 hover:text-accent disabled:opacity-30" disabled={busy || i === 0} onClick={() => move(i, -1)}>↑</button>
                      <button type="button" aria-label="Move down" className="rounded-lg px-2 py-1 hover:text-accent disabled:opacity-30" disabled={busy || i === drafts.length - 1} onClick={() => move(i, 1)}>↓</button>
                      <button type="button" aria-label="Delete scene" className="rounded-lg px-2 py-1 hover:text-danger disabled:opacity-30" disabled={busy || drafts.length <= 2} onClick={() => setDrafts((xs) => xs.filter((x) => x.id !== d.id))}>✕</button>
                    </div>
                  </div>
                  <label className="block text-sm">
                    <span className="mb-1 block text-xs text-muted">The narrator says</span>
                    <textarea
                      rows={3}
                      value={d.narration}
                      maxLength={600}
                      disabled={busy}
                      onChange={(e) => setDrafts((xs) => xs.map((x) => (x.id === d.id ? { ...x, narration: e.target.value } : x)))}
                      className="w-full rounded-xl border border-border bg-surface px-3 py-2 leading-relaxed outline-none focus:border-accent"
                    />
                  </label>
                  <details>
                    <summary className="cursor-pointer text-xs text-muted hover:text-accent">Picture description (changing it finds a new picture)</summary>
                    <textarea
                      rows={3}
                      value={d.visual}
                      maxLength={700}
                      disabled={busy}
                      onChange={(e) => setDrafts((xs) => xs.map((x) => (x.id === d.id ? { ...x, visual: e.target.value } : x)))}
                      className="mt-2 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
                    />
                  </details>
                  {sceneErrors[d.id] && <ErrorBanner message={sceneErrors[d.id]} />}
                </div>
              </Card>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        className={`${btnSecondary} mt-3`}
        disabled={busy || drafts.length >= 14}
        onClick={() => setDrafts((xs) => [...xs, { id: `new-${xs.length}-${Date.now()}`, narration: "", visual: "" }])}
      >
        + Add a scene
      </button>

      <Card className="mt-8 space-y-4">
        <h2 className="font-medium">Narrator & music</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">Voice</span>
            <select value={voice} disabled={busy} onChange={(e) => setVoice(e.target.value)} className="w-full rounded-xl border border-border bg-surface px-3 py-2">
              {(options.data?.narrators ?? []).map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </label>
          <div className="text-sm">
            <span className="mb-1.5 block font-medium">Background music <span className="font-normal text-muted">(optional)</span></span>
            <button type="button" className={btnSecondary} disabled={busy || music.isPending} onClick={() => musicInput.current?.click()}>
              {music.isPending ? "Uploading…" : project.audio ? `♬ ${project.audio.name.slice(0, 28)} · change` : "Add a song"}
            </button>
            <span className="mt-1 block text-xs text-muted">Played softly under the voice. Use music you have the rights to.</span>
          </div>
        </div>
        <ReferenceReel projectId={pid} disabled={busy} />
        <p className="-mt-1 text-xs text-muted">For a story, the narration sets the timing; a reference Reel sets the pace of the shots, the transitions and the colour.</p>
        {(render.error || music.error) && <ErrorBanner message={errorMessage(render.error ?? music.error)} />}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <button type="button" className={`${btnPrimary} col-span-2`} disabled={busy || missing > 0 || render.isPending} onClick={() => render.mutate("final")}>
            {render.isPending ? "Starting…" : "✦ Make the Reel"}
          </button>
          <button type="button" className={`${btnSecondary} col-span-2`} disabled={busy || missing > 0 || render.isPending} onClick={() => render.mutate("preview")}>
            Quick preview
          </button>
        </div>
        {missing > 0 && <p className="text-xs text-muted">Every scene needs a picture first ({missing} missing).</p>}
      </Card>
    </>
  );
}
