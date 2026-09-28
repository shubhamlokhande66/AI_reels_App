"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CaptionsPanel, MusicControls } from "@/components/editor/AudioCaptionsPanel";
import { BrandAudioPanel } from "@/components/editor/BrandAudioPanel";
import { Inspector } from "@/components/editor/Inspector";
import { QualityPanel } from "@/components/editor/QualityPanel";
import { ScriptVoicePanel } from "@/components/editor/ScriptVoicePanel";
import { TimelineTracks } from "@/components/editor/TimelineTracks";
import { ProgressBar } from "@/components/ProgressStages";
import { btnDanger, btnPrimary, btnSecondary, Card, ErrorBanner, PageHeader, Spinner } from "@/components/ui";
import { keys, useJob, useProject, useRenderTimeline, useTimeline, useTimelineActions } from "@/hooks/useApi";
import { api, assetUrl, errorMessage } from "@/lib/api";
import { formatBytes, styleLabel } from "@/lib/format";
import { op } from "@/lib/ops";
import type { QualityReport } from "@/types/api";

export default function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const project = useProject(id);
  const timeline = useTimeline(id);
  const { edit, undo, redo, restore, set } = useTimelineActions(id);
  const render = useRenderTimeline(id);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [jobId, setJobId] = useState<string>();
  const [report, setReport] = useState<QualityReport | null>(null);
  const [fixing, setFixing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const job = useJob(id, jobId, !!jobId);

  useEffect(() => {
    if (job.data?.status === "completed" || job.data?.status === "failed") {
      qc.invalidateQueries({ queryKey: keys.project(id) });
    }
  }, [job.data?.status, id, qc]);

  const check = useMutation({ mutationFn: () => api.qualityCheck(id), onSuccess: setReport });
  const fix = useMutation({
    mutationFn: (v: { code: string; segmentId: string | null }) => api.qualityFix(id, v.code, v.segmentId),
    onMutate: (v) => setFixing(v.code),
    onSettled: () => setFixing(null),
    onSuccess: (r) => {
      set(r.state);
      setReport({ ok: !r.issues.some((i) => i.severity === "error"), issues: r.issues, checked: r.checked });
    },
  });

  const state = timeline.data;
  const tl = state?.timeline ?? null;
  const p = project.data;
  const thumbs = useMemo(() => Object.fromEntries((p?.videos ?? []).map((v) => [v.id, v.thumbnailUrl ? assetUrl(v.thumbnailUrl) : undefined])), [p?.videos]);

  if (project.isLoading || timeline.isLoading) return <Spinner label="Loading editor…" />;
  if (project.error || timeline.error || !p) return <ErrorBanner message={errorMessage(project.error ?? timeline.error)} />;
  if (!tl || !state) {
    return (
      <>
        <PageHeader title={`Edit: ${p.name}`} />
        <Card>
          <p className="text-sm text-muted">There is nothing to edit yet. Generate a Reel first, then come back to refine it.</p>
          <Link href={`/projects/${id}`} className={`${btnPrimary} mt-3`}>
            Back to project
          </Link>
        </Card>
      </>
    );
  }

  const selectedIndex = tl.segments.findIndex((s) => s.id === selectedId);
  const selected = selectedIndex >= 0 ? tl.segments[selectedIndex] : null;
  const mutating = edit.isPending || undo.isPending || redo.isPending || restore.isPending;
  const rendering = job.data?.status === "queued" || job.data?.status === "processing" || render.isPending;
  const doEdit = (ops: object[], label?: string) => edit.mutate({ ops, label });
  const error = edit.error ?? undo.error ?? redo.error ?? render.error ?? check.error ?? fix.error ?? restore.error;

  const shown = p.preview ?? p.output;
  const stale = !!p.preview && (p.preview.timelineVersion ?? 0) !== state.version;

  function seek(t: number) {
    setPlayhead(t);
    if (videoRef.current && Number.isFinite(t)) videoRef.current.currentTime = t;
  }

  function splitAtPlayhead() {
    const s = tl!.segments.find((x) => playhead >= x.timelineStart + 0.25 && playhead <= x.timelineEnd - 0.25);
    if (!s) return setNotice("Move the playhead inside a shot (at least 0.25s from its edges) to split it.");
    setNotice(null);
    doEdit([op.split(s.id, playhead)], "Split shot");
    setSelectedId(s.id);
  }

  async function startRender(quality: "preview" | "final") {
    const j = await render.mutateAsync({ quality, label: quality === "final" ? "Edited version" : undefined });
    setJobId(j.id);
  }

  return (
    <>
      <PageHeader
        title={`Edit: ${p.name}`}
        subtitle={`${styleLabel(tl.style)} · ${tl.duration.toFixed(1)}s · ${tl.segments.length} shots · the originals are never changed`}
        action={
          <Link href={`/projects/${id}`} className={btnSecondary}>
            Back to project
          </Link>
        }
      />

      {error && <div className="mb-4"><ErrorBanner message={errorMessage(error)} /></div>}
      {notice && <p role="status" className="mb-4 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning">{notice}</p>}

      {/* toolbar */}
      <div role="toolbar" aria-label="Edit tools" className="mb-4 flex flex-wrap items-center gap-2">
        <button type="button" className={btnSecondary} disabled={!state.canUndo || mutating} onClick={() => undo.mutate()}>
          ↶ Undo
        </button>
        <button type="button" className={btnSecondary} disabled={!state.canRedo || mutating} onClick={() => redo.mutate()}>
          ↷ Redo
        </button>
        <span className="mx-1 hidden h-6 w-px bg-border sm:block" />
        <button type="button" className={btnSecondary} disabled={mutating} onClick={splitAtPlayhead}>
          ✂ Split at playhead
        </button>
        <button type="button" className={btnSecondary} disabled={!selected || mutating} onClick={() => selected && doEdit([op.duplicate(selected.id)], "Duplicate shot")}>
          Duplicate
        </button>
        <button type="button" className={btnSecondary} disabled={!selected || selectedIndex === 0 || mutating} onClick={() => selected && doEdit([op.move(selected.id, selectedIndex - 1)], "Move shot")}>
          ← Move
        </button>
        <button
          type="button"
          className={btnSecondary}
          disabled={!selected || selectedIndex === tl.segments.length - 1 || mutating}
          onClick={() => selected && doEdit([op.move(selected.id, selectedIndex + 1)], "Move shot")}
        >
          Move →
        </button>
        <button
          type="button"
          className={btnDanger}
          disabled={!selected || tl.segments.length < 2 || mutating}
          onClick={() => {
            if (selected) {
              doEdit([op.remove(selected.id)], "Delete shot");
              setSelectedId(null);
            }
          }}
        >
          Delete
        </button>
        <span className="ml-auto text-xs tabular-nums text-muted" aria-live="polite">
          {mutating ? "Saving…" : `Playhead ${playhead.toFixed(1)}s`}
        </span>
      </div>

      <TimelineTracks
        timeline={tl}
        selectedId={selectedId}
        onSelect={setSelectedId}
        playhead={playhead}
        onSeek={seek}
        thumbs={thumbs}
        musicName={p.audio?.name}
        // the same hands-on timeline as Beat sync: pinch / Ctrl+scroll zoom, beat markers, drag a shot's edge to trim,
        // arrow keys to move, and nudging where the song starts
        music={p.reelPlan?.music}
        musicStale={(p.reelPlan?.timelineVersion ?? 0) < state.version}
        interactive
        onEdit={doEdit}
        busy={mutating}
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,300px)_1fr]">
        {/* preview + render */}
        <div className="space-y-3">
          {shown ? (
            <video
              key={shown.id}
              ref={videoRef}
              src={assetUrl(shown.url)}
              controls
              playsInline
              preload="metadata"
              onTimeUpdate={(e) => setPlayhead(e.currentTarget.currentTime)}
              className="aspect-[9/16] w-full rounded-2xl border border-border bg-black"
              aria-label={p.preview ? "Preview" : "Rendered Reel"}
            />
          ) : (
            <div className="grid aspect-[9/16] w-full place-items-center rounded-2xl border border-dashed border-border p-4 text-center text-sm text-muted">
              Render a preview to see your edit
            </div>
          )}
          {stale && (
            <p role="status" className="rounded-xl border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
              This preview is out of date. Render a new one to see your latest edits.
            </p>
          )}
          {p.preview && !stale && <p className="text-xs text-muted">Preview · {formatBytes(p.preview.size)} · matches the timeline</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} disabled={rendering} onClick={() => startRender("preview")}>
              {rendering ? "Rendering…" : "Render preview"}
            </button>
            <button type="button" className={btnSecondary} disabled={rendering} onClick={() => startRender("final")}>
              Export final
            </button>
          </div>
          {job.data && (job.data.status === "queued" || job.data.status === "processing") && (
            <div>
              <ProgressBar value={job.data.progress} label="Render progress" />
              <p className="mt-1 text-xs text-muted">{job.data.status === "queued" ? "Waiting in the render queue…" : `Rendering ${job.data.progress}%`}</p>
            </div>
          )}
          {job.data?.status === "failed" && <ErrorBanner title="Render failed" message={job.data.error?.message ?? "The render failed."} code={job.data.error?.code} />}
          {job.data?.status === "completed" && p.output && <p className="text-xs text-success">✓ Render finished.</p>}
        </div>

        {/* inspector + panels */}
        <div className="space-y-4">
          {selected ? (
            <Inspector
              key={`${selected.id}-${selected.sourceStart}-${selected.sourceEnd}-${selected.transitionIn.type}-${selected.transitionIn.duration}`}
              segment={selected}
              index={selectedIndex}
              clips={p.videos}
              busy={mutating}
              onEdit={doEdit}
            />
          ) : (
            <Card>
              <p className="text-sm text-muted">Select a shot on the timeline to change its speed, effect, transition, framing or trim, or to replace its clip.</p>
            </Card>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <MusicControls timeline={tl} busy={mutating} onEdit={doEdit} />
            <CaptionsPanel timeline={tl} playhead={playhead} busy={mutating} onEdit={doEdit} />
          </div>
          <ScriptVoicePanel projectId={id} timeline={tl} busy={mutating} onEdit={doEdit} onState={set} />
          <BrandAudioPanel project={p} timeline={tl} busy={mutating} onState={set} />
          <QualityPanel
            report={report}
            checking={check.isPending}
            fixing={fixing}
            onCheck={() => check.mutate()}
            onFix={(code, segmentId) => fix.mutate({ code, segmentId })}
            error={check.error ? errorMessage(check.error) : fix.error ? errorMessage(fix.error) : null}
          />
        </div>
      </div>

      {/* history */}
      <section className="mt-8 grid gap-6 md:grid-cols-2" aria-label="History">
        <Card>
          <h3 className="mb-2 font-medium">Edit history</h3>
          <ol className="space-y-1 text-sm">
            {state.history.map((h, i) => (
              <li key={i} className={i === state.index ? "font-medium text-foreground" : i > state.index ? "text-muted/60" : "text-muted"}>
                {i + 1}. {h.label || "Edit"} {i === state.index && <span className="text-accent">(current)</span>}
              </li>
            ))}
          </ol>
        </Card>
        <VersionList projectId={id} onRestore={(rid) => restore.mutate(rid)} disabled={mutating} />
      </section>
    </>
  );
}

function VersionList({ projectId, onRestore, disabled }: { projectId: string; onRestore: (rid: string) => void; disabled: boolean }) {
  const q = useMutation({ mutationFn: () => api.renderings(projectId) });
  useEffect(() => q.mutate(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const finals = (q.data ?? []).filter((r) => (r.kind ?? "final") === "final");
  return (
    <Card>
      <h3 className="mb-2 font-medium">Versions</h3>
      {finals.length === 0 ? (
        <p className="text-sm text-muted">Exported versions appear here. Restore any of them to continue editing from that point.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {finals.map((r, i) => (
            <li key={r.id} className="flex items-center justify-between gap-2">
              <span>
                Version {finals.length - i}
                {r.label ? ` · ${r.label}` : ""}
                <span className="text-muted"> · {styleLabel(r.style)} · {r.duration.toFixed(0)}s</span>
              </span>
              <button type="button" className={btnSecondary} disabled={disabled} onClick={() => onRestore(r.id)} aria-label={`Restore version ${finals.length - i}`}>
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
