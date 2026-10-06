"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { assetUrl, errorMessage } from "@/lib/api";
import { ProductProjectView } from "@/components/ProductProjectView";
import { ProgressStages } from "@/components/ProgressStages";
import { PostCopy } from "@/components/PostCopy";
import { ReelPreview } from "@/components/ReelPreview";
import { PerformanceForm, ProjectTools } from "@/components/ProjectTools";
import { ReelPlanPanel } from "@/components/ReelPlanPanel";
import { DirectorFeedback, PurgeMediaButton } from "@/components/DirectorFeedback";
import { AiModeBadge } from "@/components/AiSettings";

const AI_LABEL: Record<string, string> = { ollama: "Ollama", openai: "OpenAI", gemini: "Gemini", claude: "Claude" };
import { ReviseBox } from "@/components/ReviseBox";
import { btnDanger, btnPrimary, btnSecondary, Card, ErrorBanner, PageHeader, Spinner, StatusBadge } from "@/components/ui";
import { useCancelJob, useDeleteProject, useGenerate, useProject, useRenderings } from "@/hooks/useApi";
import { formatBytes, formatDuration, styleLabel } from "@/lib/format";
import type { GenerateOptions } from "@/types/api";

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: project, isLoading, error, refetch } = useProject(id);
  const generate = useGenerate(id);
  const cancelJob = useCancelJob(id);
  const del = useDeleteProject();
  const renderings = useRenderings(id, project?.status === "completed");

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

  const busy = project.status === "processing" || generate.isPending;
  const start = (opts: GenerateOptions = {}) => generate.mutate(opts);

  return (
    <>
      <PageHeader
        title={project.name}
        subtitle={`${styleLabel(project.settings.style)} · ${project.settings.duration}s · ${project.videos.length} clip${project.videos.length === 1 ? "" : "s"}`}
        action={
          <div className="flex items-center gap-2">
            {project.timeline && (
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

      {generate.error && <div className="mb-4"><ErrorBanner message={errorMessage(generate.error)} /></div>}

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

      {project.status === "completed" && project.output && (
        <ReelPreview
          rendering={project.output}
          currentStyle={project.settings.style}
          currentDuration={project.settings.duration}
          versionCount={renderings.data?.length ?? 1}
          busy={busy}
          onGenerate={start}
        />
      )}
      {project.status === "completed" && project.output && <DirectorFeedback key={project.output.id} project={project} />}

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

      {project.timeline?.notes && project.timeline.notes.length > 0 && (
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
                    title={v.analysis.flags.join(", ")}
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

      {project.status !== "processing" && project.reelPlan && (
        <ReelPlanPanel plan={project.reelPlan} stale={(project.reelPlan.timelineVersion ?? 0) < (project.timelineVersion ?? 0)} />
      )}
      {project.status !== "processing" && <ProjectTools project={project} busy={busy} />}

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
