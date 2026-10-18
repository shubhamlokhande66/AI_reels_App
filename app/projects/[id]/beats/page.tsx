"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { BeatSyncReview } from "@/components/organisms/editor/BeatSyncReview";
import { TimelineTracks } from "@/components/organisms/editor/TimelineTracks";
import { ProgressStages } from "@/components/molecules/ProgressStages";
import { btnPrimary, btnSecondary, Card, Icon, photoClass, Spinner } from "@/components/atoms";
import { ErrorBanner, Hero, PageHeader } from "@/components/molecules";
import { useTopTitle } from "@/components/templates/TopBar";

const WAVE = [10, 30, 16, 22, 36, 12, 20, 40, 14, 26, 34, 18, 10, 38, 22, 16, 30, 12, 24, 36, 14, 20, 32, 10, 18, 40, 22, 12];
import { useProject, useTimeline, useTimelineActions } from "@/hooks/useApi";
import { assetUrl, errorMessage } from "@/lib/api";

/**
 * Its own page: does the video split correctly on the music's beats? You can also check by eye and fix it here —
 * zoom in, drag a shot's edge to trim it, nudge where the song starts. "Edit & transitions" (unchanged) is for
 * effects, captions and everything else.
 */
export default function BeatSyncPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const project = useProject(id);
  const timeline = useTimeline(id);
  const { edit, undo, redo } = useTimelineActions(id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play();
    else v.pause();
  }

  // The Space bar plays/pauses from anywhere on the page (not just when the native player has focus) — so you can
  // check the beat sync without hunting for the small player controls, the same as most editors and video sites.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== "Space" && e.key !== " ") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable || target.tagName === "BUTTON")) return;
      e.preventDefault();
      togglePlay();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const state = timeline.data;
  const tl = state?.timeline ?? null;
  const p = project.data;
  useTopTitle(p?.name);
  const thumbs = useMemo(() => Object.fromEntries((p?.videos ?? []).map((v) => [v.id, v.thumbnailUrl ? assetUrl(v.thumbnailUrl) : undefined])), [p?.videos]);

  if (project.isLoading || timeline.isLoading) return <Spinner label="Loading…" />;
  if (project.error || timeline.error || !p) return <ErrorBanner message={errorMessage(project.error ?? timeline.error)} />;
  if (p.status === "processing") {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-[14px]">
        <Hero title="Splitting your video on the music's beats…" subtitle="You can leave this page. We'll keep working." />
        <div className="card">{p.latestJob ? <ProgressStages job={p.latestJob} /> : <Spinner label="Starting…" />}</div>
        <div className="noir-panel flex flex-col gap-2.5">
          <div className="tl" style={{ height: 52 }}>
            {(p.videos.length ? p.videos : [{ id: "a" }, { id: "b" }, { id: "c" }]).slice(0, 6).map((v, k) => (
              <div key={v.id} className={`photo ${photoClass(v.id)}`} style={{ flex: [3, 2, 3, 2, 2, 3][k], borderRadius: 6 }} />
            ))}
          </div>
          <div className="wave" style={{ height: 46, padding: 0, justifyContent: "space-between" }} aria-hidden>
            {WAVE.map((h, k) => (
              <i key={k} className={k % 3 === 1 ? "h" : ""} style={{ height: h }} />
            ))}
          </div>
          <span style={{ fontSize: 11.5 }}>Gold lines: the cuts landing on beats</span>
        </div>
      </div>
    );
  }
  if (p.status === "failed") {
    return (
      <>
        <PageHeader title="Beat sync" />
        <ErrorBanner title="The Reel could not be made" message={p.error?.message ?? "Something went wrong."} code={p.error?.code} />
        <Link href={`/projects/${id}`} className={`${btnPrimary} mt-3 inline-block`}>
          Back to project
        </Link>
      </>
    );
  }
  if (!tl || !state) {
    return (
      <>
        <PageHeader title="Beat sync" />
        <Card>
          <p className="text-sm text-muted">There is nothing to check yet. Generate a Reel first, then come back here.</p>
          <Link href={`/projects/${id}`} className={`${btnPrimary} mt-3`}>
            Back to project
          </Link>
        </Card>
      </>
    );
  }

  function seek(t: number) {
    setPlayhead(t);
    if (videoRef.current && Number.isFinite(t)) videoRef.current.currentTime = t;
  }

  const shown = p.preview ?? p.output;
  const mutating = edit.isPending || undo.isPending || redo.isPending;
  const error = edit.error ?? undo.error ?? redo.error;
  const doEdit = (ops: object[], label?: string) => edit.mutate({ ops, label });

  return (
    <>
      <PageHeader
        title="Beat sync"
        subtitle="Video + audio: check every cut lands on the music before you add transitions or effects."
        action={
          <div className="flex gap-2">
            {/* on a phone the top bar's back arrow already goes back to the project */}
            <Link href={`/projects/${id}`} className={`${btnSecondary} hidden md:inline-flex`}>
              Back to project
            </Link>
            <Link href={`/projects/${id}/edit`} className={btnSecondary}>
              Edit &amp; transitions
            </Link>
          </div>
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorBanner message={errorMessage(error)} />
        </div>
      )}

      <div role="toolbar" aria-label="Beat sync tools" className="mb-3 flex items-center gap-2">
        <button type="button" className={btnPrimary} disabled={!shown} onClick={togglePlay}>
          <Icon name={playing ? "pause" : "play"} size={16} />
          {playing ? "Pause" : "Play"}
        </button>
        <span className="mx-1 hidden h-6 w-px bg-border sm:block" />
        <button type="button" className={btnSecondary} disabled={!state.canUndo || mutating} onClick={() => undo.mutate()}>
          <Icon name="undo" size={16} /> Undo
        </button>
        <button type="button" className={btnSecondary} disabled={!state.canRedo || mutating} onClick={() => redo.mutate()}>
          <Icon name="redo" size={16} /> Redo
        </button>
        <span className="text-xs tabular-nums text-muted" aria-live="polite">
          {mutating ? "Saving…" : shown ? `Space to play/pause · ${playhead.toFixed(1)}s` : ""}
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
        music={p.reelPlan?.music}
        musicStale={(p.reelPlan?.timelineVersion ?? 0) < state.version}
        interactive
        onEdit={doEdit}
        busy={mutating}
      />
      {p.reelPlan && (
        <p className="mt-1 text-[11px] text-muted">
          <span className="text-success">✓</span> a cut lands within 80ms of a beat or a real strong accent · <span className="text-warning">⚠</span> it doesn&apos;t.
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,300px)_1fr]">
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
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              className="aspect-[9/16] w-full rounded-2xl border border-border bg-black"
              aria-label={p.preview ? "Preview" : "Rendered Reel"}
            />
          ) : (
            <div className="grid aspect-[9/16] w-full place-items-center rounded-2xl border border-dashed border-border p-4 text-center text-sm text-muted">
              No render yet — generate this Reel first.
            </div>
          )}
        </div>

        <BeatSyncReview
          timeline={tl}
          music={p.reelPlan?.music}
          musicStale={(p.reelPlan?.timelineVersion ?? 0) < state.version}
          onContinue={() => router.push(`/projects/${id}/edit`)}
        />
      </div>
    </>
  );
}
