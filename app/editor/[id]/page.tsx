"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, assetUrl, errorMessage } from "@/lib/api";
import { MAX_AUDIO_MB, MAX_VIDEO_MB, PICKER_AUDIO, PICKER_VIDEO, isAudioFile, isVideoFile, tooBig } from "@/lib/format";
import { keys, useProject, useRenderTimeline, useTimelineActions } from "@/hooks/useApi";
import { op } from "@/lib/ops";
import { Icon } from "@/components/atoms/Icon";
import { LivePlayer } from "@/components/organisms/studio/LivePlayer";
import { Gallery } from "@/components/organisms/studio/Gallery";
import { Inspector, type ClipTab } from "@/components/organisms/studio/Inspector";
import { MediaBin } from "@/components/organisms/studio/MediaBin";
import { Library, LIB_TABS, type LibTab } from "@/components/organisms/studio/Library";
import { ProTimeline } from "@/components/organisms/studio/ProTimeline";
import { ProgressStages } from "@/components/molecules/ProgressStages";
import { Spinner } from "@/components/atoms";
import { ErrorBanner } from "@/components/molecules";

type Lib = LibTab;
const RAIL = LIB_TABS;

const tc = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
};

// the editor's glyphs drawn as the design's line icons
const GLYPH: Record<string, string> = {
  "↶": "undo", "↷": "redo", "✂": "scissors", "⧉": "copy", "←": "back", "→": "chevron", "🗑": "trash", T: "captions",
  "⇄": "share", "✧": "sparkle", "◐": "palette", "✎": "wand", "⏱": "history", "▦": "image", "♪": "music",
};
const glyph = (icon: string, size = 18) => (GLYPH[icon] ? <Icon name={GLYPH[icon]} size={size} /> : <span aria-hidden>{icon}</span>);

/** A tool (design: the Pro editor's toolbar of plain buttons; phones: an icon over its name). */
function ToolBtn({ icon, label, onClick, disabled, danger, hotkey, compact, named, on }: { icon: string; label: string; onClick: () => void; disabled?: boolean; danger?: boolean; hotkey?: string; compact?: boolean; named?: boolean; on?: boolean }) {
  if (named || compact) {
    const iconOnly = icon === "↶" || icon === "↷";
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={hotkey ? `${label} (${hotkey})` : label}
        aria-label={label}
        aria-pressed={named ? on : undefined}
        className={`btn sm shrink-0 disabled:opacity-30 ${on ? "!border-[var(--accent)] !bg-[var(--chip-on)]" : ""} ${iconOnly ? "!w-9 !px-0" : ""}`}
        style={danger ? { color: "#e88b7d" } : undefined}
      >
        {iconOnly ? glyph(icon, 16) : label}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hotkey ? `${label} (${hotkey})` : label}
      aria-label={label}
      className={`flex min-w-[52px] flex-col items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition-colors disabled:opacity-30 ${danger ? "text-muted hover:text-danger" : "text-muted hover:text-foreground"}`}
    >
      {glyph(icon, 22)}
      <span>{label}</span>
    </button>
  );
}

/** The manual editor, laid out like CapCut / Filmora: a library on the left (media, audio, text, effects, transitions,
 * filters), the player in the middle, the selected clip's properties on the right, and the timeline with its toolbar
 * across the bottom. On a phone: the player, the timeline, and a tool bar at the bottom that opens each panel. */
export default function StudioEditorPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const project = useProject(id);
  const addVideoInput = useRef<HTMLInputElement>(null);
  const addAudioInput = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [clipTab, setClipTab] = useState<ClipTab>("video"); // "Uploading 40%" while a + upload runs
  const [tlHeight, setTlHeight] = useState(340); // px, the timeline's height on a desktop (drag its top edge)
  const start = useQuery({ queryKey: keys.timeline(id), queryFn: () => api.startEditing(id), retry: false });
  const catalog = useQuery({ queryKey: ["editor-catalog"], queryFn: api.editorCatalog, staleTime: Infinity });
  const { edit, undo, redo } = useTimelineActions(id);
  const render = useRenderTimeline(id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sheet, setSheet] = useState<Lib | "clip" | null>(null); // phone: the open bottom panel
  const [notice, setNotice] = useState<string | null>(null);

  const state = start.data;
  // the Reel's real beat markers (again after each edit: the part of the song can move)
  const markers = useQuery({ queryKey: ["markers", id, state?.version, project.data?.audio?.id], queryFn: () => api.timelineMarkers(id),
                             enabled: !!state?.timeline && !!project.data?.audio, // any edit with a song: the server finds its beats (a song added in the editor too)
                             staleTime: Infinity, retry: false, placeholderData: (prev) => prev });
  const editMarkers = async (add: number[], remove: number[]) => {
    try {
      qc.setQueryData(["markers", id, state?.version, project.data?.audio?.id], await api.editMarkers(id, add, remove));
    } catch (e) {
      setNotice(errorMessage(e));
    }
  };
  const autoCut = async (density: "both" | "strong" | "drops") => {
    setNotice(null);
    try {
      qc.setQueryData(keys.timeline(id), await api.autoCut(id, density));
      setSelectedId(null);
    } catch (e) {
      setNotice(errorMessage(e));
    }
  };
  // the renderer's framing / correction per shot: the live preview shows what the export will look like (again after each edit)
  const hints = useQuery({ queryKey: ["previewHints", id, state?.version], queryFn: () => api.previewHints(id), enabled: !!state?.timeline,
                           staleTime: Infinity, retry: false, placeholderData: (prev) => prev });
  const tl = state?.timeline ?? null;
  const p = project.data;
  const busy = edit.isPending || undo.isPending || redo.isPending || p?.status === "processing";
  const thumbs = useMemo(() => Object.fromEntries((p?.videos ?? []).map((v) => [v.id, v.thumbnailUrl ? assetUrl(v.thumbnailUrl) : undefined])), [p?.videos]);
  const clipUrls = useMemo(() => Object.fromEntries((p?.videos ?? []).map((v) => [v.id, assetUrl(v.url) ?? ""])), [p?.videos]);
  const seg = tl?.segments.find((s) => s.id === selectedId) ?? null;
  const segIdx = seg && tl ? tl.segments.indexOf(seg) : -1;

  const doEdit = useCallback(
    (ops: object[], label?: string) => {
      setNotice(null);
      edit.mutate({ ops, label }, { onError: (e) => setNotice(errorMessage(e)) });
    },
    [edit],
  );
  /** The + at the end of a track: upload, then (videos) put the new clips at the end of the edit. */
  const addFromTrack = async (kind: "video" | "audio", picked: File[]) => {
    const files = picked.filter(kind === "video" ? isVideoFile : isAudioFile);
    const big = tooBig(files, kind === "video" ? MAX_VIDEO_MB : MAX_AUDIO_MB);
    if (big.length) return setNotice(`Too large: ${big.join(", ")}`);
    if (!files.length) return setNotice(kind === "video" ? "Choose video files." : "Choose a music file (.mp3, .mpeg, .m4a, .wav…).");
    setNotice(null);
    setAdding("Uploading 0%");
    try {
      const progress = (f: number) => setAdding(`Uploading ${Math.round(f * 100)}%`);
      if (kind === "video") {
        const res = await api.uploadVideos(id, files, progress);
        if (res.failed.length) setNotice(`Not added: ${res.failed.map((f) => f.name).join(", ")}`);
        await qc.invalidateQueries({ queryKey: keys.project(id) });
        if (!tl) await start.refetch();
        else if (res.uploaded.length)
          doEdit(res.uploaded.map((m, k) => ({ type: "insert", clipId: m.id, length: 3, index: tl.segments.length + k })), res.uploaded.length > 1 ? `Add ${res.uploaded.length} clips` : "Add clip");
      } else {
        await api.uploadAudio(id, files[0], progress);
        await qc.invalidateQueries({ queryKey: keys.project(id) });
      }
    } catch (e) {
      setNotice(errorMessage(e));
    } finally {
      setAdding(null);
    }
  };
  const split = useCallback(() => {
    const s = tl?.segments.find((x) => playhead >= x.timelineStart && playhead < x.timelineEnd);
    if (!s) return;
    if (playhead - s.timelineStart < 0.25 || s.timelineEnd - playhead < 0.25) return setNotice("Move the playhead inside the clip (not at its edge) to split it.");
    doEdit([op.split(s.id, playhead)], "Split");
  }, [tl, playhead, doEdit]);
  const remove = useCallback(() => {
    if (!seg || (tl?.segments.length ?? 0) <= 1) return;
    doEdit([op.remove(seg.id)], "Delete clip");
    setSelectedId(null);
  }, [seg, tl, doEdit]);
  const move = (d: -1 | 1) => seg && doEdit([op.move(seg.id, segIdx + d)], "Move clip");
  const openLibrary = (l: Lib) => {
    // effects and transitions work on a clip: the one under the playhead when none is selected
    if ((l === "effects" || l === "transitions") && !seg && tl) {
      const under = tl.segments.find((x) => playhead >= x.timelineStart && playhead < x.timelineEnd) ?? tl.segments[0];
      if (under) setSelectedId(under.id);
    }
    setSheet(l);
  };

  // inside the editor a pinch never zooms the whole page (the timeline handles its own pinch-to-zoom)
  useEffect(() => {
    const stop = (e: Event) => {
      if ((e as WheelEvent).ctrlKey || e.type.startsWith("gesture")) e.preventDefault();
    };
    window.addEventListener("wheel", stop, { passive: false });
    window.addEventListener("gesturestart", stop as EventListener, { passive: false });
    window.addEventListener("gesturechange", stop as EventListener, { passive: false });
    return () => {
      window.removeEventListener("wheel", stop);
      window.removeEventListener("gesturestart", stop as EventListener);
      window.removeEventListener("gesturechange", stop as EventListener);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === " ") {
        e.preventDefault();
        setPlaying((v) => !v);
      } else if ((e.ctrlKey || e.metaKey) && k === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          if (state?.canRedo) redo.mutate();
        } else if (state?.canUndo) undo.mutate();
      } else if ((e.ctrlKey || e.metaKey) && k === "y") {
        e.preventDefault();
        if (state?.canRedo) redo.mutate();
      } else if ((e.ctrlKey || e.metaKey) && k === "b") {
        e.preventDefault();
        split();
      } else if (k === "s" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        split();
      } else if (k === "delete" || k === "backspace") {
        e.preventDefault();
        remove();
      } else if (k === "escape") {
        setSelectedId(null);
        setSheet(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state?.canUndo, state?.canRedo, undo, redo, split, remove]);

  const exportHd = useMutation({
    mutationFn: (quality: "preview" | "final") => render.mutateAsync({ quality, label: "Made in the editor" }),
    onError: (e) => setNotice(errorMessage(e)),
  });
  useEffect(() => {
    if (p?.status === "completed" && exportHd.isSuccess) void qc.invalidateQueries({ queryKey: keys.project(id) });
  }, [p?.status, exportHd.isSuccess, qc, id]);

  if (project.isLoading || start.isLoading)
    return (
      <div className="pro-workspace grid min-h-screen place-items-center">
        <Spinner label="Opening the editor…" />
      </div>
    );
  if (!p)
    return (
      <div className="pro-workspace min-h-screen p-6">
        <ErrorBanner message={errorMessage(project.error)} />
        <Link href="/editor" className="mt-4 inline-block text-sm text-accent">← Back to the editor</Link>
      </div>
    );
  if (p.settings.reelType === "story" || p.settings.reelType === "product")
    return (
      <div className="pro-workspace min-h-screen p-6">
        <ErrorBanner message="This is a story or product Reel: open it from Projects. The editor works with video clips." />
      </div>
    );

  const noClips = p.videos.filter((v) => !v.purged).length === 0;
  const exporting = p.status === "processing";
  const done = !exporting && exportHd.isSuccess && p.output;

  const library = (which: Lib, cat = catalog.data) =>
    which === "media" ? (
      <MediaBin
        project={p}
        busy={busy}
        onUploaded={() => {
          if (!tl) void qc.invalidateQueries({ queryKey: keys.timeline(id) });
        }}
        onAdd={(clipId) => {
          if (!tl) return void start.refetch();
          doEdit([{ type: "insert", clipId, length: 3, index: segIdx >= 0 ? segIdx + 1 : undefined }], "Add clip");
        }}
      />
    ) : tl ? (
      <Gallery
        tab={which}
        catalog={cat}
        tl={tl}
        seg={seg}
        thumb={seg ? thumbs[seg.clipId] : Object.values(thumbs)[0]}
        prevThumb={segIdx > 0 ? thumbs[tl.segments[segIdx - 1].clipId] : undefined}
        playhead={playhead}
        busy={busy}
        onEdit={doEdit}
        onSplit={split}
        onDuplicate={() => seg && doEdit([op.duplicate(seg.id)], "Duplicate")}
        onDelete={remove}
      />
    ) : null;

  const inspector = tl ? (
    <Inspector tl={tl} seg={seg} thumb={seg ? thumbs[seg.clipId] : undefined} catalog={catalog.data} busy={busy} onEdit={doEdit} openLibrary={openLibrary} playhead={playhead} tab={clipTab} onTab={setClipTab} />
  ) : null;

  return (
    <div className="pro-workspace flex min-h-screen flex-col lg:h-screen lg:overflow-hidden">
      <input ref={addVideoInput} type="file" accept={PICKER_VIDEO} multiple hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; void addFromTrack("video", f); }} />
      <input ref={addAudioInput} type="file" accept={PICKER_AUDIO} hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; void addFromTrack("audio", f); }} />
      {/* top bar */}
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-[#0d0b09] px-4 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))]">
        <div className="row min-w-0">
          <Link href="/editor" className="ib plain" aria-label="Back">
            <Icon name="back" />
          </Link>
          <b className="truncate font-display text-[20px] font-semibold">{p.name}</b>
          <span className="mu xs shrink-0">{busy ? "Saving…" : "Saved"}</span>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <button type="button" className="ib plain" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!state?.canUndo || busy} onClick={() => undo.mutate()}>
            <Icon name="undo" size={18} />
          </button>
          <button type="button" className="ib plain" aria-label="Redo" title="Redo (Ctrl+Y)" disabled={!state?.canRedo || busy} onClick={() => redo.mutate()}>
            <Icon name="redo" size={18} />
          </button>
          <button type="button" className="btn sm hidden sm:inline-flex" disabled={!tl?.segments.length || busy || exporting} onClick={() => exportHd.mutate("preview")}>
            Quick preview
          </button>
          <button type="button" className="btn g sm" disabled={!tl?.segments.length || busy || exporting} onClick={() => exportHd.mutate("final")}>
            {exporting ? "Exporting…" : "Export"}
          </button>
        </div>
      </header>

      {(exporting && p.latestJob) || done || notice || (start.error && !noClips) ? (
        <div className="space-y-2 border-b border-border px-3 py-2">
          {exporting && p.latestJob && <ProgressStages job={p.latestJob} />}
          {done && (
            <p className="rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
              Your Reel is ready.{" "}
              <Link href={`/projects/${id}`} className="font-semibold underline">
                Watch, download or post it
              </Link>
            </p>
          )}
          {notice && <ErrorBanner message={notice} />}
          {start.error && !noClips && <ErrorBanner message={errorMessage(start.error)} onRetry={() => void start.refetch()} />}
        </div>
      ) : null}

      {/* workspace */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {sheet && (
          <aside aria-label={sheet === "clip" ? "Clip" : RAIL.find((r) => r.id === sheet)?.label} className="hidden min-h-0 w-[380px] shrink-0 flex-col border-l border-border bg-surface lg:order-last lg:flex">
            <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
              <h2 className="text-sm font-semibold">{sheet === "clip" ? (seg ? "Clip" : "Project") : RAIL.find((r) => r.id === sheet)?.label}</h2>
              <button type="button" className="ib plain !h-8 !w-8" onClick={() => setSheet(null)} aria-label="Close panel">
                <Icon name="close" size={16} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {sheet === "clip" ? (
                inspector
              ) : (
                <div className="h-full [&_.grid-cols-3]:!grid-cols-4 [&_.grid-cols-2]:!grid-cols-3">
                  <Library compact tab={sheet} onTab={(t) => openLibrary(t)} catalog={catalog.data} only={["text", "transitions", "effects", "looks"]}>
                    {(filtered) => library(sheet, filtered)}
                  </Library>
                </div>
              )}
            </div>
          </aside>
        )}

        {/* player */}
        <section aria-label="Player" className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 p-2 lg:p-3">
          {tl ? (
            <>
              <div className="flex h-[46svh] min-h-0 w-full justify-center lg:h-auto lg:flex-1">
                <LivePlayer
                  fill
                  hints={hints.data}
                  timeline={tl}
                  clipUrls={clipUrls}
                  musicUrl={p.audio ? assetUrl(p.audio.url) : null}
                  playhead={playhead}
                  onTime={setPlayhead}
                  playing={playing}
                  onPlaying={setPlaying}
                />
              </div>
              <div className="row mono sm">
                <span className="mu w-20 text-right">{tc(playhead)}</span>
                <button type="button" className="ib plain" onClick={() => setPlayhead(0)} aria-label="Back to start">
                  <Icon name="prev" size={16} />
                </button>
                <button type="button" className="ib" style={{ background: "var(--foreground)", color: "#0a0908", borderColor: "transparent" }} onClick={() => setPlaying((v) => !v)} aria-label={playing ? "Pause" : "Play"} title="Space">
                  <Icon name={playing ? "pause" : "play"} size={16} />
                </button>
                <button type="button" className="ib plain" onClick={() => { setPlaying(false); setPlayhead(Math.max(0, tl.duration - 0.05)); }} aria-label="To the end">
                  <Icon name="next" size={16} />
                </button>
                <span className="mu w-20">{tc(tl.duration)}</span>
              </div>
            </>
          ) : noClips ? (
            <div className="grid aspect-[9/16] w-full max-w-[300px] place-items-center rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted">
              <div className="space-y-3">
                <p>Start by adding your clips.</p>
                <button type="button" className="btn g sm" onClick={() => openLibrary("media")}>
                  + Add clips
                </button>
              </div>
            </div>
          ) : (
            <Spinner label="Preparing your edit…" />
          )}
        </section>

      </div>

      {/* timeline toolbar + tracks */}
      {tl && (
        <div className="relative shrink-0 border-t border-border bg-surface lg:flex lg:flex-col" style={{ "--tlh": `${tlHeight}px` } as React.CSSProperties}>
          {/* drag to give the timeline (clips, music waveform) more or less room */}
          <div role="separator" aria-orientation="horizontal" aria-label="Resize the timeline" title="Drag to resize the timeline"
            className="absolute inset-x-0 -top-1 z-20 hidden h-2 cursor-row-resize hover:bg-accent/40 lg:block"
            onPointerDown={(e) => {
              const y0 = e.clientY;
              const h0 = tlHeight;
              const move = (ev: PointerEvent) => setTlHeight(Math.min(Math.max(h0 + y0 - ev.clientY, 200), window.innerHeight * 0.7));
              const up = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }} />
          <div className="px-2 pb-2 pt-1 lg:max-h-[var(--tlh)] lg:overflow-y-auto">
            <ProTimeline
              tools={
                <>
                  <ToolBtn compact icon="↶" label="Undo" hotkey="Ctrl+Z" disabled={!state?.canUndo || busy} onClick={() => undo.mutate()} />
                  <ToolBtn compact icon="↷" label="Redo" hotkey="Ctrl+Y" disabled={!state?.canRedo || busy} onClick={() => redo.mutate()} />
                  <span className="mx-1 h-4 w-px bg-border" />
                  <ToolBtn compact icon="✂" label="Split" hotkey="S" disabled={busy} onClick={split} />
                  <ToolBtn compact icon="⧉" label="Duplicate" disabled={!seg || busy} onClick={() => seg && doEdit([op.duplicate(seg.id)], "Duplicate")} />
                  <ToolBtn compact icon="←" label="Move earlier" disabled={!seg || segIdx <= 0 || busy} onClick={() => move(-1)} />
                  <ToolBtn compact icon="→" label="Move later" disabled={!seg || segIdx >= tl.segments.length - 1 || busy} onClick={() => move(1)} />
                  <ToolBtn compact icon="🗑" label="Delete" hotkey="Del" danger disabled={!seg || tl.segments.length <= 1 || busy} onClick={remove} />
                  <span className="mx-1 h-4 w-px bg-border" />
                  <span className="mx-1 h-4 w-px bg-border" />
                  <ToolBtn named icon="T" label="Titles" on={sheet === "text"} onClick={() => openLibrary("text")} />
                  <ToolBtn named icon="⇄" label="Transitions" on={sheet === "transitions"} onClick={() => openLibrary("transitions")} />
                  <ToolBtn named icon="✧" label="Effects" on={sheet === "effects"} onClick={() => openLibrary("effects")} />
                  <ToolBtn named icon="◐" label="Filters" on={sheet === "looks"} onClick={() => openLibrary("looks")} />
                  <ToolBtn named icon="✎" label={seg ? "Edit clip" : "Project"} on={sheet === "clip" && clipTab !== "speed"} onClick={() => {
                    setClipTab("video");
                    setSheet("clip");
                  }} />
                  <ToolBtn named icon="⏱" label="Speed" on={sheet === "clip" && clipTab === "speed"} onClick={() => {
                    // the clip under the playhead when none is selected
                    const target = seg ?? tl.segments.find((x) => playhead >= x.timelineStart && playhead < x.timelineEnd) ?? tl.segments[0];
                    if (!target) return;
                    setSelectedId(target.id);
                    setClipTab("speed");
                    setSheet("clip");
                  }} />
                  {adding && <span className="ml-2 text-[10px] text-accent">{adding}</span>}
                </>
              }
              tl={tl}
              selectedId={selectedId}
              onSelect={(sid) => {
                setSelectedId(sid);
                if (sid && typeof window !== "undefined" && window.innerWidth < 1024) setSheet("clip");
              }}
              playhead={playhead}
              onSeek={(t) => {
                setPlaying(false);
                setPlayhead(t);
              }}
              thumbs={thumbs}
              musicName={p.audio?.name}
              busy={busy}
              onEdit={doEdit}
              onTransitionClick={() => openLibrary("transitions")}
              markers={markers.data?.markers}
              waveform={markers.data?.waveform}
              beatHint={!p.audio ? "Add a song to get beat markers, snapping and auto-cut" : markers.isFetching && !markers.data ? "Finding the beats of your song…" : markers.isError ? `Beat markers: ${errorMessage(markers.error)}` : undefined}
              onAddMarker={(t) => void editMarkers([t], [])}
              onRemoveMarker={(t) => void editMarkers([], [t])}
              onAutoCut={(d) => void autoCut(d)}
              onAddVideo={() => addVideoInput.current?.click()}
              onAddAudio={() => addAudioInput.current?.click()}
            />
          </div>
        </div>
      )}

      {/* phone: CapCut-style bottom tool bar + slide-up panels */}
      <nav aria-label="Tools" className="sticky bottom-0 z-30 flex justify-around border-t border-border bg-surface px-1 pb-[max(0.4rem,env(safe-area-inset-bottom))] pt-1.5 lg:hidden">
        {seg ? (
          <>
            <ToolBtn icon="✎" label="Edit" onClick={() => setSheet("clip")} />
            <ToolBtn icon="✂" label="Split" disabled={busy} onClick={split} />
            <ToolBtn icon="✧" label="Effects" onClick={() => openLibrary("effects")} />
            <ToolBtn icon="⇄" label="Transition" onClick={() => openLibrary("transitions")} />
            <ToolBtn icon="🗑" label="Delete" danger disabled={busy} onClick={remove} />
          </>
        ) : (
          RAIL.map((r) => <ToolBtn key={r.id} icon={r.icon} label={r.label} onClick={() => openLibrary(r.id)} />)
        )}
      </nav>
      {sheet && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <button type="button" aria-label="Close" className="absolute inset-0 bg-black/50" onClick={() => setSheet(null)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[62vh] overflow-y-auto rounded-t-3xl border-t border-border bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">{sheet === "clip" ? "Clip" : RAIL.find((r) => r.id === sheet)?.label}</h2>
              <button type="button" className="text-sm text-muted" onClick={() => setSheet(null)}>
                Done
              </button>
            </div>
            {sheet === "clip" ? (
              inspector
            ) : (
              <div className="-mx-4 h-[52vh]">
                <Library tab={sheet} onTab={(t) => openLibrary(t)} catalog={catalog.data} only={["text", "transitions", "effects", "looks"]}>
                  {(filtered) => library(sheet, filtered)}
                </Library>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
