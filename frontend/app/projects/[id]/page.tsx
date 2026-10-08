"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, assetUrl, errorMessage } from "@/lib/api";
import { ProductProjectView } from "@/components/ProductProjectView";
import { StoryStudio } from "@/components/StoryStudio";
import { ProgressStages } from "@/components/ProgressStages";
import { PostCopy } from "@/components/PostCopy";
import { ReelPreview } from "@/components/ReelPreview";
import { PublishPanel } from "@/components/PublishPanel";
import { RetentionNotice } from "@/components/RetentionSettings";
import { PerformanceForm, ProjectTools } from "@/components/ProjectTools";
import { ReelPlanPanel } from "@/components/ReelPlanPanel";
import { CreativeDirectorPanel } from "@/components/CreativeDirectorPanel";
import { ProjectFootageGate, checkProject } from "@/components/ProjectFootageGate";
import type { FootageCheck } from "@/lib/footage";
import { DirectorFeedback, PurgeMediaButton } from "@/components/DirectorFeedback";
import { AiModeBadge } from "@/components/AiSettings";

const AI_LABEL: Record<string, string> = { ollama: "Ollama", openai: "OpenAI", gemini: "Gemini", claude: "Claude" };
import { ReviseBox } from "@/components/ReviseBox";
import { btnDanger, btnPrimary, btnSecondary, Card, ErrorBanner, PageHeader, Spinner, StatusBadge } from "@/components/ui";
import { useAdmin, useCancelJob, useDeleteProject, useGenerate, useProject, useRenderings, useTimelineActions } from "@/hooks/useApi";
import { formatBytes, formatDuration, styleLabel } from "@/lib/format";
import type { ClipSummary, GenerateOptions } from "@/types/api";

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: project, isLoading, error, refetch } = useProject(id);
  const generate = useGenerate(id);
  const cancelJob = useCancelJob(id);
  const del = useDeleteProject();
  const renderings = useRenderings(id, project?.status === "completed");
  const { restore } = useTimelineActions(id);
  const { admin } = useAdmin();
  const lastOpts = useRef<GenerateOptions>({}); // what the Retry button repeats after a failed start // the technical internals (plan tables, safety log, diagnostics) are for the administrator
  // not enough footage for the Reel length: asked before anything is generated (add clips, or shorten)
  const [gateFor, setGateFor] = useState<{ check: FootageCheck; opts?: GenerateOptions; run?: () => void } | null>(null);

  // A prompt typed on the create page ("AI Edit"): pre-fill it into "Change this Reel" and run it once, automatically,
  // as soon as the Reel is ready. Taken from the URL once, then cleared so a refresh does not run it again.
  const [initialPrompt] = useState(() => searchParams.get("prompt") ?? "");
  useEffect(() => {
    if (searchParams.get("prompt")) router.replace(`/projects/${id}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isLoading) return <Spinner label="Loading project…" />;
  if (error || !project) return <ErrorBanner message={errorMessage(error)} onRetry={() => refetch()} />;

  if (project.settings.reelType === "product") return <ProductProjectView project={project} />;
  if (project.settings.reelType === "story") return <StoryStudio project={project} />;

  const busy = project.status === "processing" || generate.isPending;
  // after a click that starts a job, take the person to its live progress at the top of the page
  const toProgress = () => window.scrollTo({ top: 0, behavior: "smooth" });
  const start = (opts: GenerateOptions = {}) => {
    const check = checkProject(project, opts.duration);
    if (!check.ok) return setGateFor({ check, opts });
    setGateFor(null);
    lastOpts.current = opts;
    generate.mutate(opts, { onSuccess: toProgress });
  };
  const guard = (run: () => void) => {
    const check = checkProject(project);
    if (!check.ok) return setGateFor({ check, run });
    run();
  };
  const continueAfterGate = async (seconds: number | null) => {
    const g = gateFor;
    setGateFor(null);
    if (!g) return;
    if (g.run) {
      if (seconds) await api.updateProject(id, { duration: seconds });
      g.run();
    } else {
      generate.mutate(seconds ? { ...g.opts, duration: seconds, label: `${seconds}s (fits the footage)` } : g.opts ?? {}, { onSuccess: toProgress });
    }
  };

  return (
    <>
      <PageHeader
        title={project.name}
        subtitle={`${styleLabel(project.settings.style)} · ${project.settings.duration}s · ${project.videos.length} clip${project.videos.length === 1 ? "" : "s"}`}
        action={
          <div className="flex items-center gap-2">
            {admin && project.timeline && (
              <Link href={`/projects/${id}/beats`} className={btnSecondary}>
                🎵 Beat sync
              </Link>
            )}
            {project.timeline && (
              <Link href={`/projects/${id}/edit`} className={btnSecondary}>
                ✎ Edit timeline
              </Link>
            )}
            <StatusBadge status={project.status} />
          </div>
        }
      />

      {generate.error && (
        <div className="mb-4">
          <ErrorBanner message={errorMessage(generate.error)} onRetry={() => generate.mutate(lastOpts.current, { onSuccess: toProgress })} />
        </div>
      )}
      {gateFor && (
        <ProjectFootageGate project={project} check={gateFor.check} onContinue={(s) => void continueAfterGate(s)} onClose={() => setGateFor(null)} />
      )}

      {project.status === "processing" && (
        <Card>
          <h2 className="mb-4 font-semibold">Creating your Reel…</h2>
          {project.latestJob ? (
            <ProgressStages
              job={project.latestJob}
              onCancel={() => cancelJob.mutate(project.latestJob!.id)}
              cancelling={cancelJob.isPending}
            />
          ) : (
            <Spinner label="Starting…" />
          )}
          {cancelJob.isError && <div className="mt-3"><ErrorBanner message={errorMessage(cancelJob.error)} /></div>}
        </Card>
      )}

      {project.status === "failed" && (
        <div className="space-y-4">
          <ErrorBanner
            title="Rendering failed"
            message={project.error?.message ?? "The Reel could not be created."}
            code={project.error?.code}
          />
          {project.error?.details ? (
            <details className="rounded-xl border border-border bg-surface p-3 text-xs text-muted">
              <summary className="cursor-pointer">Technical details</summary>
              <pre className="mt-2 whitespace-pre-wrap break-words">{String(project.error.details)}</pre>
            </details>
          ) : null}
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => start()}>
            Try again
          </button>
        </div>
      )}

      {project.status === "draft" && (
        <Card className="space-y-3">
          <p className="text-sm text-muted">
            {project.audio ? "Ready to generate." : "This project has no music yet — the Reel needs a song."}
          </p>
          <button type="button" className={btnPrimary} disabled={busy || !project.audio || project.videos.length === 0} onClick={() => start()}>
            Generate Reel
          </button>
        </Card>
      )}

      <RetentionNotice updatedAt={project.updatedAt} hasReel={!!project.output} />
      {project.status === "completed" && project.output && (
        <ReelPreview
          rendering={project.output}
          currentStyle={project.settings.style}
          currentDuration={project.settings.duration}
          versionCount={renderings.data?.length ?? 1}
          busy={busy}
          onGenerate={start}
          songStart={project.audio ? project.timeline?.audioStart ?? null : null}
        />
      )}
      {project.status === "completed" && project.output && (
        <PublishPanel key={`pub-${project.output.id}`} projectId={project.id} rendering={project.output} />
      )}
      {project.status === "completed" && project.output && <DirectorFeedback key={project.output.id} project={project} />}

      {project.timeline && project.status !== "draft" && project.status !== "failed" && (
        <CreativeDirectorPanel project={project} busy={busy} onGenerate={start} guard={guard} />
      )}

      {project.timeline && project.status !== "draft" && project.status !== "failed" && (
        <ReviseBox projectId={id} busy={busy} initialText={initialPrompt} autoRun={!!initialPrompt} />
      )}

      {project.status === "completed" && project.output && (
        <div className="mt-3">
          <PerformanceForm key={project.output.id} rendering={project.output} />
        </div>
      )}

      {project.status === "completed" && project.output?.postCopy && (
        <PostCopy copy={project.output.postCopy} />
      )}

      {project.timeline?.ai && (
        <p className="mt-6 flex flex-wrap items-center gap-2 text-sm" aria-label="AI used">
          <span className="font-medium">AI: {AI_LABEL[project.timeline.ai.provider] ?? project.timeline.ai.provider}</span>
          <AiModeBadge local={project.timeline.ai.local} provider={project.timeline.ai.model || null} />
          <span className="text-xs text-muted">
            {project.timeline.ai.director ? "planned every shot (checked by the safety layer)" : "assisted the editor"}
            {project.timeline.ai.fallbackUsed ? " · fallback provider answered" : ""}
          </span>
        </p>
      )}

      {admin && project.timeline?.notes && project.timeline.notes.length > 0 && (
        <ul className="mt-6 space-y-1 rounded-2xl border border-border bg-surface p-4 text-sm text-muted" aria-label="Editing notes">
          {project.timeline.notes.map((n) => (
            <li key={n}>✦ {n}</li>
          ))}
        </ul>
      )}

      {project.timeline?.warnings && project.timeline.warnings.length > 0 && (
        <ul className="mt-6 space-y-1 rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm text-warning" aria-label="Warnings">
          {project.timeline.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}

      {project.status === "completed" && renderings.data && renderings.data.length > 1 && (
        <section className="mt-10">
          <h2 className="mb-3 text-lg font-semibold">Versions</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {renderings.data.map((r) => (
              <li key={r.id} className="rounded-2xl border border-border bg-surface p-3">
                <video src={assetUrl(r.url)} controls preload="none" playsInline className="aspect-[9/16] max-h-72 w-full rounded-xl bg-black" aria-label={`Version ${r.label || r.id}`} />
                <p className="mt-2 text-sm font-medium">{r.label || styleLabel(r.style)}</p>
                <p className="text-xs text-muted">
                  {styleLabel(r.style)} · {formatDuration(r.duration)} · {formatBytes(r.size)}
                </p>
                <a href={assetUrl(r.downloadUrl)} download className="mt-1 inline-block text-xs text-accent hover:underline">
                  Download
                </a>
                {r.id !== project.output?.id && (
                  <button
                    type="button"
                    className="ml-3 text-xs text-accent hover:underline disabled:opacity-50"
                    disabled={busy || restore.isPending}
                    onClick={() => restore.mutate(r.id, { onSuccess: () => refetch() })}
                  >
                    Use this version
                  </button>
                )}
                <div className="mt-1">
                  <PerformanceForm rendering={r} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10 grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Videos</h2>
          <ul className="space-y-2 text-sm">
            {project.videos.map((v) => (
              <li key={v.id} className="flex items-center gap-3">
                {v.thumbnailUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={assetUrl(v.thumbnailUrl)} alt="" className="h-10 w-16 rounded-md object-cover" />
                )}
                <span className="min-w-0 flex-1 truncate">{v.name}</span>
                {v.purged && <span className="text-xs text-muted">deleted (privacy)</span>}
                {v.analysis && (
                  <span
                    className={`text-xs ${v.analysis.usable ? "text-muted" : "text-warning"}`}
                    title={clipTitle(v.analysis)}
                  >
                    {v.analysis.usable ? `quality ${Math.round(v.analysis.qualityScore * 100)}%` : "skipped"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Music &amp; analysis</h2>
          {project.audio ? (
            <p className="text-sm">
              {project.audio.name} <span className="text-muted">· {formatDuration(project.audio.duration)}</span>
            </p>
          ) : (
            <p className="text-sm text-muted">No music uploaded.</p>
          )}
          {project.analysis?.audio && (
            <p className="mt-2 text-sm text-muted">
              {Math.round(project.analysis.audio.bpm)} BPM · {project.analysis.audio.beatCount} beats detected
            </p>
          )}
        </Card>
      </section>

      {admin && project.status !== "processing" && project.reelPlan && (
        <ReelPlanPanel plan={project.reelPlan} stale={(project.reelPlan.timelineVersion ?? 0) < (project.timelineVersion ?? 0)} />
      )}
      {project.status !== "processing" && <ProjectTools project={project} busy={busy} admin={admin} />}

      <div className="mt-10 flex flex-wrap items-start gap-3">
        {project.status === "completed" && project.videos.some((v) => !v.purged) && <PurgeMediaButton project={project} busy={busy} />}
        <button
          type="button"
          className={btnDanger}
          disabled={busy || del.isPending}
          onClick={() => {
            if (window.confirm(`Delete "${project.name}" and all of its files?`)) {
              del.mutate(id, { onSuccess: () => router.push("/projects") });
            }
          }}
        >
          Delete project
        </button>
      </div>
    </>
  );
}

/** Hover text for a clip: its flags, then what the shot analysis measured (when it did). */
function clipTitle(a: ClipSummary): string {
  const parts = [a.flags.join(", ")];
  const sizes = Object.entries(a.shotSizes ?? {}).sort((x, y) => y[1] - x[1]);
  if (sizes.length) parts.push(`mostly ${sizes[0][0]} shots`);
  if (a.compositionScore != null) parts.push(`composition ${Math.round(a.compositionScore * 100)}%`);
  if (a.productVisibility != null) parts.push(`product visible ${Math.round(a.productVisibility * 100)}%`);
  const best = a.bestSegments?.[0];
  if (best) parts.push(`best moment ${best.start.toFixed(1)}–${best.end.toFixed(1)}s`);
  return parts.filter(Boolean).join(" · ");
}
