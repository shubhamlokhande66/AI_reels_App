"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CaptionsPanel, MusicControls } from "@/components/organisms/editor/AudioCaptionsPanel";
import { BrandAudioPanel } from "@/components/organisms/editor/BrandAudioPanel";
import { Inspector } from "@/components/organisms/editor/Inspector";
import { QualityPanel } from "@/components/organisms/editor/QualityPanel";
import { ScriptVoicePanel } from "@/components/organisms/editor/ScriptVoicePanel";
import { TimelineTracks } from "@/components/organisms/editor/TimelineTracks";
import { ProgressBar } from "@/components/molecules/ProgressStages";
import { btnPrimary, Card, Icon, Spinner } from "@/components/atoms";
import { ErrorBanner, PageHeader } from "@/components/molecules";
import { TopAction, useTopTitle } from "@/components/templates/TopBar";
import { keys, useJob, useProject, useRenderings, useRenderTimeline, useTimeline, useTimelineActions } from "@/hooks/useApi";
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
  const [playing, setPlaying] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const job = useJob(id, jobId, !!jobId);
  const renders = useRenderings(id);

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
  useTopTitle(p ? `Edit · ${p.name}` : null);
  const thumbs = useMemo(() => Object.fromEntries((p?.videos ?? []).map((v) => [v.id, v.thumbnailUrl ? assetUrl(v.thumbnailUrl) : undefined])), [p?.videos]);

  if (project.isLoading || timeline.isLoading) return <Spinner label="Loading editor…" />;
  if (project.error || timeline.error || !p) return <ErrorBanner message={errorMessage(project.error ?? timeline.error)} />;
  if (!tl || !state) {
    return (
      <>
        <PageHeader title={`Edit · ${p.name}`} />
        <Card>
          <p className="text-sm text-muted">There is nothing to edit yet. Make the Reel first, then come back to fine-tune it.</p>
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

  const finals = (renders.data ?? []).filter((r) => (r.kind ?? "final") === "final");
  const rows: { id: string; icon: string; tile: string; title: string; value: string; body: React.ReactNode }[] = [
    {
      id: "captions", icon: "captions", tile: "b1", title: "Captions",
      value: tl.captions.length ? tl.captionStyle : "Off",
      body: <CaptionsPanel timeline={tl} playhead={playhead} busy={mutating} onEdit={doEdit} />,
    },
    {
      id: "voice", icon: "mic", tile: "b6", title: "Script & voice", value: tl.voice ? "Voice-over on" : "Off",
      body: <ScriptVoicePanel projectId={id} timeline={tl} busy={mutating} onEdit={doEdit} onState={set} />,
    },
    {
      id: "brand", icon: "star", tile: "b2", title: "Brand & audio", value: p.audio ? "Music on" : "No music",
      body: (
        <div className="flex flex-col gap-3">
          <MusicControls timeline={tl} busy={mutating} onEdit={doEdit} />
          <BrandAudioPanel project={p} timeline={tl} busy={mutating} onState={set} />
        </div>
      ),
    },
    {
      id: "quality", icon: "check", tile: "b5", title: "Quality", value: report ? (report.ok ? "All good" : `${report.issues.length} to check`) : "Check it",
      body: (
        <QualityPanel
          report={report}
          checking={check.isPending}
          fixing={fixing}
          onCheck={() => check.mutate()}
          onFix={(code, segmentId) => fix.mutate({ code, segmentId })}
          error={check.error ? errorMessage(check.error) : fix.error ? errorMessage(fix.error) : null}
        />
      ),
    },
    {
      id: "history", icon: "history", tile: "b4", title: "Edit history", value: `${state.history.length} change${state.history.length === 1 ? "" : "s"}`,
      body: (
        <ol className="flex flex-col gap-1 sm">
          {state.history.map((h, i) => (
            <li key={i} className={i === state.index ? "font-bold" : "mu"}>
              {i + 1}. {h.label || "Edit"} {i === state.index && <span className="ac">(now)</span>}
            </li>
          ))}
        </ol>
      ),
    },
    {
      id: "versions", icon: "layers", tile: "b4", title: "Versions", value: String(finals.length),
      body: finals.length === 0 ? (
        <p className="mu sm">Every version you render appears here. Restore one to keep editing from there.</p>
      ) : (
        <ul className="flex flex-col gap-2 sm">
          {finals.map((r, i) => (
            <li key={r.id} className="between">
              <span className="min-w-0 truncate">
                Version {finals.length - i}
                {r.label ? ` · ${r.label}` : ""} <span className="mu">· {r.duration.toFixed(0)} s</span>
              </span>
              <button type="button" className="ac font-bold disabled:opacity-50" disabled={mutating} onClick={() => restore.mutate(r.id)} aria-label={`Restore version ${finals.length - i}`}>
                Restore
              </button>
            </li>
          ))}
        </ul>
      ),
    },
  ];
  const tool = "btn sm shrink-0 !bg-[#1c1916] !border-[#2e2924] !text-[#f3ede3]";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
      <div className="hidden items-end justify-between gap-4 md:flex">
        <div>
          <h1 className="h1">Edit · {p.name}</h1>
          <p className="sub">
            {styleLabel(tl.style)} · {tl.duration.toFixed(1)} s · {tl.segments.length} shots · your original clips are never changed
          </p>
        </div>
      </div>
      <TopAction>
        <button type="button" className="btn g sm" disabled={rendering} onClick={() => startRender("final")}>
          {rendering ? "Rendering…" : "Render"}
        </button>
      </TopAction>

      {error && <ErrorBanner message={errorMessage(error)} />}
      {notice && (
        <p role="status" className="card sm" style={{ color: "var(--warning)" }}>
          {notice}
        </p>
      )}

      <section className="noir noir-panel relative flex flex-col gap-2" aria-label="Timeline" style={{ fontSize: 10.5 }}>
        <div className="between flex-wrap" style={{ color: "#f3ede3" }}>
          <span className="mono text-[12px]">
            {fmt(playhead)} / {fmt(tl.duration)}
          </span>
          <div role="toolbar" aria-label="Edit tools" className="row w-full overflow-x-auto pb-0.5 md:w-auto" style={{ gap: 6, scrollbarWidth: "none" }}>
            <button type="button" className={tool} disabled={!state.canUndo || mutating} onClick={() => undo.mutate()} aria-label="Undo">
              <Icon name="undo" size={16} />
            </button>
            <button type="button" className={tool} disabled={!state.canRedo || mutating} onClick={() => redo.mutate()} aria-label="Redo">
              <Icon name="redo" size={16} />
            </button>
            <button type="button" className={tool} disabled={mutating} onClick={splitAtPlayhead}>
              Split
            </button>
            <button type="button" className={tool} disabled={!selected || mutating} onClick={() => selected && doEdit([op.duplicate(selected.id)], "Duplicate shot")}>
              Duplicate
            </button>
            <button type="button" className={tool} aria-label="Move earlier" disabled={!selected || selectedIndex === 0 || mutating} onClick={() => selected && doEdit([op.move(selected.id, selectedIndex - 1)], "Move shot")}>
              <Icon name="back" size={16} />
            </button>
            <button
              type="button"
              className={tool}
              aria-label="Move later"
              disabled={!selected || selectedIndex === tl.segments.length - 1 || mutating}
              onClick={() => selected && doEdit([op.move(selected.id, selectedIndex + 1)], "Move shot")}
            >
              <Icon name="chevron" size={16} />
            </button>
            <button
              type="button"
              className={`${tool} !text-[#e88b7d]`}
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
            <button
              type="button"
              aria-label={playing ? "Pause" : "Play"}
              disabled={!shown}
              onClick={() => {
                const v = videoRef.current;
                if (v) void (v.paused ? v.play() : v.pause());
              }}
              className="ib"
              style={{ width: 36, height: 36, background: "#1c1916", borderColor: "#2e2924", color: "#f3ede3" }}
            >
              <Icon name={playing ? "pause" : "play"} size={16} />
            </button>
          </div>
        </div>
        <TimelineTracks
          timeline={tl}
          selectedId={selectedId}
          onSelect={setSelectedId}
          playhead={playhead}
          onSeek={seek}
          thumbs={thumbs}
          musicName={p.audio?.name}
          music={p.reelPlan?.music}
          musicStale={(p.reelPlan?.timelineVersion ?? 0) < state.version}
          interactive
          onEdit={doEdit}
          busy={mutating}
        />
        <span aria-live="polite">{mutating ? "Saving…" : "Tap a shot to change it. Drag its edges to trim."}</span>
      </section>

      <div className="grid gap-3 md:grid-cols-[minmax(0,300px)_1fr]">
        <div className="flex flex-col gap-2.5">
          {shown ? (
            <video
              key={shown.id}
              ref={videoRef}
              src={assetUrl(shown.url)}
              controls
              playsInline
              preload="metadata"
              onTimeUpdate={(e) => setPlayhead(e.currentTarget.currentTime)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              className="mx-auto aspect-[9/16] w-full max-w-[min(100%,calc(55svh*9/16))] rounded-2xl border border-border bg-black"
              aria-label={p.preview ? "Preview" : "Your Reel"}
            />
          ) : (
            <div className="photo p1 grid aspect-[9/16] w-full place-items-center p-4 text-center text-sm text-white/80" style={{ borderRadius: 16 }}>
              Make a preview to see your edit
            </div>
          )}
          {stale && <p className="sm" style={{ color: "var(--warning)" }}>This preview is older than your edits. Make a new one to see them.</p>}
          {p.preview && !stale && <p className="mu xs">Preview · {formatBytes(p.preview.size)} · up to date</p>}
          <div className="g2">
            <button type="button" className="btn sm" disabled={rendering} onClick={() => startRender("preview")}>
              Quick preview
            </button>
            <button type="button" className="btn g sm" disabled={rendering} onClick={() => startRender("final")}>
              Render final
            </button>
          </div>
          {job.data && (job.data.status === "queued" || job.data.status === "processing") && (
            <div>
              <ProgressBar value={job.data.progress} label="Render progress" showEta />
              <p className="mu xs mt-1">{job.data.status === "queued" ? "Waiting for a free spot…" : `Rendering ${job.data.progress}%`}</p>
            </div>
          )}
          {job.data?.status === "failed" && <ErrorBanner title="The render stopped" message={job.data.error?.message ?? "Something went wrong while rendering."} code={job.data.error?.code} />}
          {job.data?.status === "completed" && p.output && <p className="sm text-success">Your Reel is ready.</p>}
        </div>

        <div className="flex min-w-0 flex-col gap-3">
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
            <p className="card mu sm">Tap a shot on the timeline to change its speed, effect, transition, framing or trim, or to swap its clip.</p>
          )}
          <section className="card" style={{ padding: "4px 12px", gap: 0 }} aria-label="More tools">
            {rows.map((r) => (
              <div key={r.id} className="border-b border-border last:border-b-0">
                <button type="button" className="li !border-b-0" aria-expanded={openRow === r.id} onClick={() => setOpenRow(openRow === r.id ? null : r.id)}>
                  <span className={`it ${r.tile} s`}>
                    <Icon name={r.icon} size={16} />
                  </span>
                  <b>{r.title}</b>
                  <span className="mu sm max-w-[40%] truncate capitalize">{r.value}</span>
                  <Icon name={openRow === r.id ? "down" : "chevron"} size={18} />
                </button>
                {openRow === r.id && <div className="pb-3">{r.body}</div>}
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}

function fmt(t: number) {
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, "0")}`;
}

