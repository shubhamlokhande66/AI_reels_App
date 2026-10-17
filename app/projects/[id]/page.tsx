"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, assetUrl, errorMessage } from "@/lib/api";
import { ProductProjectView } from "@/components/organisms/ProductProjectView";
import { StoryStudio } from "@/components/organisms/StoryStudio";
import { ProgressStages } from "@/components/molecules/ProgressStages";
import { PostCopy } from "@/components/molecules/PostCopy";
import { ReelPreview } from "@/components/organisms/ReelPreview";
import { PublishPanel } from "@/components/organisms/PublishPanel";
import { RetentionNotice } from "@/components/organisms/RetentionSettings";
import { PerformanceForm, ProjectTools } from "@/components/organisms/ProjectTools";
import { ReelPlanPanel } from "@/components/organisms/ReelPlanPanel";
import { InstagramReport } from "@/components/organisms/InstagramReport";
import { CreativeDirectorPanel } from "@/components/organisms/CreativeDirectorPanel";
import { ProjectFootageGate, checkProject } from "@/components/molecules/ProjectFootageGate";
import type { FootageCheck } from "@/lib/footage";
import { DirectorFeedback, PurgeMediaButton } from "@/components/organisms/DirectorFeedback";
import { AiModeBadge } from "@/components/organisms/AiSettings";

const AI_LABEL: Record<string, string> = { ollama: "Ollama", openai: "OpenAI", gemini: "Gemini", claude: "Claude" };
// Design: the project page's four tabs
const TABS = [
  { id: "preview", label: "Preview" },
  { id: "plan", label: "Plan" },
  { id: "tools", label: "Tools" },
  { id: "publish", label: "Publish" },
] as const;
type TabId = (typeof TABS)[number]["id"];
import { ReviseBox } from "@/components/organisms/ReviseBox";
import { Icon, Spinner, StatusBadge, Thumb } from "@/components/atoms";
import { EmptyState, ErrorBanner } from "@/components/molecules";
import { MoreMenu, type MoreItem } from "@/components/molecules/MoreMenu";
import { TopAction, useTopTitle } from "@/components/templates/TopBar";
import { useAdmin, useCancelJob, useDeleteProject, useGenerate, useProject, useRenderings, useTimelineActions } from "@/hooks/useApi";
import { formatDuration, styleLabel } from "@/lib/format";
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

  const [tab, setTab] = useState<TabId>(() => (TABS.some((t) => t.id === searchParams.get("tab")) ? (searchParams.get("tab") as TabId) : "preview"));
  const pickTab = (t: TabId) => {
    setTab(t);
    window.scrollTo({ top: 0 });
  };
  useTopTitle(project?.name);

  if (isLoading) return <Spinner label="Loading your project…" />;
  if (error || !project) return <ErrorBanner message={errorMessage(error)} onRetry={() => refetch()} />;

  if (project.settings.reelType === "product") return <ProductProjectView project={project} />;
  if (project.settings.reelType === "story") return <StoryStudio project={project} />;

  const busy = project.status === "processing" || generate.isPending;
  // after a click that starts a job, take the person to its live progress at the top of the page
  const toProgress = () => {
    setTab("preview");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
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

  const versionNo = renderings.data && project.output ? renderings.data.length - renderings.data.findIndex((r) => r.id === project.output!.id) : undefined;
  const ig = project.reelPlan?.instagram;
  const igFixes = ig ? ig.checks.filter((c) => (c.status === "fail" || c.status === "warn") && c.tip) : [];
  const more: MoreItem[] = [
    { label: "Open in the editor", icon: "scissors", href: `/editor/${id}` },
    ...(project.timeline ? [{ label: "Captions, voice and brand", icon: "captions", href: `/projects/${id}/edit` }] : []),
    ...(admin && project.timeline ? [{ label: "Beat sync check", icon: "wave", href: `/projects/${id}/beats` }] : []),
    { label: "Delete this project", icon: "trash", danger: true, disabled: busy || del.isPending, onClick: deleteProject },
  ];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      <div className="hidden items-end justify-between gap-4 md:flex">
        <div className="min-w-0">
          <h1 className="h1 truncate">{project.name}</h1>
          <p className="sub">
            {styleLabel(project.settings.style)} · {project.settings.duration} s · {project.videos.length} clip{project.videos.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="row">
          <StatusBadge status={project.status} />
          <Link href={`/editor/${id}`} className="btn">
            Open in the editor
          </Link>
          <MoreMenu items={more} />
        </div>
      </div>
      <TopAction>
        <span className="md:hidden">
          <MoreMenu items={more} />
        </span>
      </TopAction>

      <div className="tabs2" role="tablist" aria-label="Sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => pickTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {generate.error && <ErrorBanner message={errorMessage(generate.error)} onRetry={() => generate.mutate(lastOpts.current, { onSuccess: toProgress })} />}
      {gateFor && (
        <ProjectFootageGate project={project} check={gateFor.check} onContinue={(s) => void continueAfterGate(s)} onClose={() => setGateFor(null)} />
      )}

      {tab === "preview" && (
        <>
          {project.status === "processing" && (
            <section className="card" aria-label="Making your Reel">
              <span className="h2">Making your Reel…</span>
              <span className="mu sm">You can leave this page. We&apos;ll keep working.</span>
              {project.latestJob ? (
                <ProgressStages job={project.latestJob} onCancel={() => cancelJob.mutate(project.latestJob!.id)} cancelling={cancelJob.isPending} />
              ) : (
                <Spinner label="Starting…" />
              )}
              {cancelJob.isError && <ErrorBanner message={errorMessage(cancelJob.error)} />}
            </section>
          )}

          {project.status === "failed" && (
            <>
              <ErrorBanner title="We couldn't make this Reel" message={project.error?.message ?? "Something went wrong while making the Reel."} code={project.error?.code} />
              {project.error?.details ? (
                <details className="card mu xs">
                  <summary className="cursor-pointer">Technical details</summary>
                  <pre className="whitespace-pre-wrap break-words">{String(project.error.details)}</pre>
                </details>
              ) : null}
              <button type="button" className="btn g big" disabled={busy} onClick={() => start()}>
                Try again
              </button>
            </>
          )}

          {project.status === "draft" && (
            <section className="card">
              <span className="h2">Ready when you are</span>
              <span className="mu sm">{project.audio ? "Your clips and song are here. Make the Reel now." : "This project has no song yet: add one in the Tools tab, then make the Reel."}</span>
              <button type="button" className="btn g" disabled={busy || !project.audio || project.videos.length === 0} onClick={() => start()}>
                Make my Reel
              </button>
            </section>
          )}

          <RetentionNotice updatedAt={project.updatedAt} hasReel={!!project.output} />
          {project.status === "completed" && project.output && (
            <ReelPreview
              rendering={project.output}
              currentStyle={project.settings.style}
              currentDuration={project.settings.duration}
              versionCount={renderings.data?.length ?? 1}
              versionNumber={versionNo}
              busy={busy}
              onGenerate={start}
              onPost={() => pickTab("publish")}
              songStart={project.audio ? project.timeline?.audioStart ?? null : null}
            />
          )}
          {project.status === "completed" && project.output && <DirectorFeedback key={project.output.id} project={project} />}
          {project.timeline && project.status !== "draft" && project.status !== "failed" && (
            <ReviseBox projectId={id} busy={busy} initialText={initialPrompt} autoRun={!!initialPrompt} />
          )}

          {ig && project.status !== "processing" && (
            <section className="card" aria-label="Instagram check">
              <div className="between">
                <span className="h2">Instagram check</span>
                <span className={`badge ${igFixes.length ? "b-run" : "b-ok"}`}>{igFixes.length ? `${igFixes.length} fix${igFixes.length === 1 ? "" : "es"}` : "All good"}</span>
              </div>
              {igFixes.slice(0, 3).map((c) => (
                <span key={c.id} className="sm">
                  {c.tip}
                </span>
              ))}
              {!igFixes.length && <span className="mu sm">{ig.verdict}</span>}
              <button type="button" className="ac sm self-start font-bold" onClick={() => pickTab("publish")}>
                See the full check · score {ig.score}
              </button>
            </section>
          )}

          {project.timeline?.warnings && project.timeline.warnings.length > 0 && (
            <section className="card sm" aria-label="Warnings" style={{ borderColor: "color-mix(in srgb, var(--warning) 35%, var(--border))" }}>
              {project.timeline.warnings.map((w) => (
                <span key={w} className="text-warning">
                  {w}
                </span>
              ))}
            </section>
          )}

          {project.status === "completed" && renderings.data && renderings.data.length > 1 && (
            <section className="card" style={{ gap: 6 }} aria-label="Versions">
              <span className="h2">Versions</span>
              {renderings.data.map((r, k) => {
                const current = r.id === project.output?.id;
                return (
                  <div key={r.id} className="between sm min-h-[32px]">
                    <span className={`min-w-0 truncate ${current ? "" : "mu"}`}>
                      Version {renderings.data!.length - k} · {r.label || styleLabel(r.style)}
                    </span>
                    <span className="row shrink-0" style={{ gap: 12 }}>
                      <a href={assetUrl(r.downloadUrl)} download className="mu font-bold hover:text-accent">
                        Download
                      </a>
                      {current ? (
                        <span className="badge b-ok">Current</span>
                      ) : (
                        <button type="button" className="ac font-bold disabled:opacity-50" disabled={busy || restore.isPending} onClick={() => restore.mutate(r.id, { onSuccess: () => refetch() })}>
                          Restore
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
            </section>
          )}
        </>
      )}

      {tab === "plan" && (
        <>
          {project.timeline && project.status !== "draft" && project.status !== "failed" ? (
            <CreativeDirectorPanel project={project} busy={busy} onGenerate={start} guard={guard} />
          ) : (
            <EmptyState icon="layers" title="No plan yet" hint="The plan appears once your Reel has been made: the idea, the shots and why each one was chosen." />
          )}
          <section className="card" aria-label="Your clips">
            <div className="between">
              <span className="h2">Your clips</span>
              <span className="mu sm">{project.videos.length}</span>
            </div>
            {project.videos.map((v) => (
              <div key={v.id} className="row sm">
                <Thumb id={v.id} url={v.thumbnailUrl} className="h-10 w-10" />
                <span className="min-w-0 flex-1 truncate">{v.name}</span>
                {v.purged && <span className="mu xs">deleted for privacy</span>}
                {v.analysis && (
                  <span className={`badge ${v.analysis.usable ? "b-ok" : "b-bad"}`} title={clipTitle(v.analysis)}>
                    {v.analysis.usable ? `${Math.round(v.analysis.qualityScore * 100)}% quality` : "not used"}
                  </span>
                )}
              </div>
            ))}
          </section>
          <section className="card" aria-label="Song">
            <span className="h2">Song</span>
            {project.audio ? (
              <span className="sm">
                {project.audio.name} <span className="mu">· {formatDuration(project.audio.duration)}</span>
              </span>
            ) : (
              <span className="mu sm">No song added.</span>
            )}
            {project.analysis?.audio && (
              <span className="mu sm">
                {Math.round(project.analysis.audio.bpm)} BPM · {project.analysis.audio.beatCount} beats found
              </span>
            )}
            {project.timeline?.ai && (
              <span className="row mu xs flex-wrap" aria-label="AI used">
                <span>AI: {AI_LABEL[project.timeline.ai.provider] ?? project.timeline.ai.provider}</span>
                <AiModeBadge local={project.timeline.ai.local} provider={project.timeline.ai.model || null} />
                <span>{project.timeline.ai.director ? "planned every shot, checked by the safety layer" : "helped the editor"}</span>
              </span>
            )}
          </section>
          {admin && project.timeline?.notes && project.timeline.notes.length > 0 && (
            <section className="card mu sm" aria-label="Editing notes">
              {project.timeline.notes.map((n) => (
                <span key={n}>{n}</span>
              ))}
            </section>
          )}
          {admin && project.status !== "processing" && project.reelPlan && (
            <ReelPlanPanel plan={project.reelPlan} stale={(project.reelPlan.timelineVersion ?? 0) < (project.timelineVersion ?? 0)} />
          )}
        </>
      )}

      {tab === "tools" && (
        <>
          <section className="card" style={{ padding: "4px 12px", gap: 0 }} aria-label="Edit by hand">
            <Link href={`/editor/${id}`} className="li">
              <span className="it b4 s">
                <Icon name="scissors" size={16} />
              </span>
              <b>Open in the editor</b>
              <span className="mu sm">Cut by hand</span>
              <Icon name="chevron" size={18} />
            </Link>
            {project.timeline && (
              <Link href={`/projects/${id}/edit`} className="li">
                <span className="it b1 s">
                  <Icon name="captions" size={16} />
                </span>
                <b>Captions, voice and brand</b>
                <Icon name="chevron" size={18} />
              </Link>
            )}
            {admin && project.timeline && (
              <Link href={`/projects/${id}/beats`} className="li">
                <span className="it b5 s">
                  <Icon name="wave" size={16} />
                </span>
                <b>Beat sync check</b>
                <Icon name="chevron" size={18} />
              </Link>
            )}
          </section>
          {project.status !== "processing" ? <ProjectTools project={project} busy={busy} admin={admin} /> : <p className="mu sm">More tools open once your Reel is ready.</p>}
          <section className="card" aria-label="Delete" style={{ borderColor: "color-mix(in srgb, var(--danger) 30%, var(--border))" }}>
            <span className="h2 text-danger">Delete</span>
            <span className="mu sm">Your finished Reels stay when you delete the uploads. Deleting the project removes everything and can&apos;t be undone.</span>
            <div className="flex flex-wrap items-start gap-2">
              {project.status === "completed" && project.videos.some((v) => !v.purged) && <PurgeMediaButton project={project} busy={busy} />}
              <button type="button" className="btn danger" disabled={busy || del.isPending} onClick={deleteProject}>
                Delete this project
              </button>
            </div>
          </section>
        </>
      )}

      {tab === "publish" && (
        <>
          {project.status === "completed" && project.output ? (
            <>
              <PublishPanel key={`pub-${project.output.id}`} projectId={project.id} rendering={project.output} />
              {project.output.postCopy && <PostCopy copy={project.output.postCopy} />}
              <section className="card" aria-label="How it did">
                <span className="h2">How did it do?</span>
                <span className="mu sm">After posting, copy the numbers here. They teach us what works for you.</span>
                <PerformanceForm key={project.output.id} rendering={project.output} />
              </section>
              {ig && <InstagramReport report={ig} stale={(project.reelPlan?.timelineVersion ?? 0) < (project.timelineVersion ?? 0)} />}
            </>
          ) : (
            <EmptyState icon="share" title="Nothing to post yet" hint="When your Reel is ready you can post it, copy the caption and hashtags, and check it for Instagram here." />
          )}
        </>
      )}
    </div>
  );

  function deleteProject() {
    if (window.confirm(`Delete "${project!.name}" and all of its files? This can't be undone.`)) {
      del.mutate(id, { onSuccess: () => router.push("/projects") });
    }
  }
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
