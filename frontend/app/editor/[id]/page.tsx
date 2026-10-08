"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, assetUrl, errorMessage } from "@/lib/api";
import { keys, useProject, useRenderTimeline, useTimelineActions } from "@/hooks/useApi";
import { op } from "@/lib/ops";
import { LivePlayer } from "@/components/studio/LivePlayer";
import { Gallery } from "@/components/studio/Gallery";
import { Inspector } from "@/components/studio/Inspector";
import { MediaBin } from "@/components/studio/MediaBin";
import { Library, LIB_TABS, type LibTab } from "@/components/studio/Library";
import { ProTimeline } from "@/components/studio/ProTimeline";
import { ProgressStages } from "@/components/ProgressStages";
import { ErrorBanner, Spinner } from "@/components/ui";

type Lib = LibTab;
const RAIL = LIB_TABS;

const tc = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
};

function ToolBtn({ icon, label, onClick, disabled, danger, hotkey }: { icon: string; label: string; onClick: () => void; disabled?: boolean; danger?: boolean; hotkey?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hotkey ? `${label} (${hotkey})` : label}
      aria-label={label}
      className={`flex min-w-[44px] flex-col items-center gap-0.5 rounded-lg px-2 py-1 text-[10px] transition-colors disabled:opacity-30 ${danger ? "text-muted hover:text-danger" : "text-muted hover:bg-white/5 hover:text-foreground"}`}
    >
      <span aria-hidden className="text-base leading-5">{icon}</span>
      <span className="hidden sm:block">{label}</span>
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
  const start = useQuery({ queryKey: keys.timeline(id), queryFn: () => api.startEditing(id), retry: false });
  const catalog = useQuery({ queryKey: ["editor-catalog"], queryFn: api.editorCatalog, staleTime: Infinity });
  const { edit, undo, redo } = useTimelineActions(id);
  const render = useRenderTimeline(id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [lib, setLib] = useState<Lib>("media");
  const [sheet, setSheet] = useState<Lib | "clip" | null>(null); // phone: the open bottom panel
  const [notice, setNotice] = useState<string | null>(null);

  const state = start.data;
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
    setLib(l);
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
    <Inspector tl={tl} seg={seg} thumb={seg ? thumbs[seg.clipId] : undefined} catalog={catalog.data} busy={busy} onEdit={doEdit} openLibrary={openLibrary} />
  ) : null;

  return (
    <div className="pro-workspace flex min-h-screen flex-col lg:h-screen lg:overflow-hidden">
      {/* top bar */}
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/editor" className="rounded-lg px-2 py-1 text-sm text-muted hover:bg-white/5 hover:text-foreground" aria-label="Back">
            ←
          </Link>
          <h1 className="truncate text-sm font-semibold">{p.name}</h1>
          <span className="hidden text-xs text-muted sm:inline">· 9:16 · {tl ? `${tl.segments.length} clips` : ""}</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="rounded-lg px-3 py-1.5 text-xs text-muted hover:bg-white/5 hover:text-foreground disabled:opacity-30" disabled={!tl?.segments.length || busy || exporting} onClick={() => exportHd.mutate("preview")}>
            Quick render
          </button>
          <button type="button" className="lux-btn-gold rounded-lg px-4 py-1.5 text-xs font-semibold disabled:opacity-40" disabled={!tl?.segments.length || busy || exporting} onClick={() => exportHd.mutate("final")}>
            {exporting ? "Exporting…" : "Export"}
          </button>
        </div>
      </header>

      {(exporting && p.latestJob) || done || notice || (start.error && !noClips) ? (
        <div className="space-y-2 border-b border-border px-3 py-2">
          {exporting && p.latestJob && <ProgressStages job={p.latestJob} />}
          {done && (
            <p className="rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
              ✓ Your Reel is ready.{" "}
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
        {/* desktop: the library, Filmora style (tabs across the top, categories, search) */}
        <section aria-label="Library" className="hidden min-h-0 w-[40%] min-w-[380px] max-w-[560px] shrink-0 border-r border-border lg:flex lg:flex-col">
          <Library tab={lib} onTab={setLib} catalog={catalog.data}>
            {(filtered) => library(lib, filtered)}
          </Library>
        </section>

        {/* player */}
        <section aria-label="Player" className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 p-2 lg:p-3">
          {tl ? (
            <>
              <div className="flex h-[46svh] min-h-0 w-full justify-center lg:h-auto lg:flex-1">
                <LivePlayer
                  fill
                  timeline={tl}
                  clipUrls={clipUrls}
                  musicUrl={p.audio ? assetUrl(p.audio.url) : null}
                  playhead={playhead}
                  onTime={setPlayhead}
                  playing={playing}
                  onPlaying={setPlaying}
                />
              </div>
              <div className="flex items-center gap-3">
                <span className="w-20 text-right text-xs tabular-nums text-accent">{tc(playhead)}</span>
                <button type="button" className="rounded-lg px-2 py-1 text-muted hover:text-foreground" onClick={() => setPlayhead(0)} aria-label="Back to start">
                  ⏮
                </button>
                <button type="button" className="lux-btn-gold grid h-10 w-10 place-items-center rounded-full" onClick={() => setPlaying((v) => !v)} aria-label={playing ? "Pause" : "Play"} title="Space">
                  {playing ? "❚❚" : "▶"}
                </button>
                <span className="w-20 text-xs tabular-nums text-muted">{tc(tl.duration)}</span>
              </div>
            </>
          ) : noClips ? (
            <div className="grid aspect-[9/16] w-full max-w-[300px] place-items-center rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted">
              <div className="space-y-3">
                <p>Start by adding your clips.</p>
                <button type="button" className="lux-btn-gold rounded-full px-4 py-2 text-xs font-semibold" onClick={() => openLibrary("media")}>
                  + Add clips
                </button>
              </div>
            </div>
          ) : (
            <Spinner label="Preparing your edit…" />
          )}
        </section>

        {/* desktop: properties */}
        <aside aria-label="Properties" className="hidden w-[300px] shrink-0 overflow-y-auto border-l border-border p-3 lg:block">
          {inspector}
        </aside>
      </div>

      {/* timeline toolbar + tracks */}
      {tl && (
        <div className="shrink-0 border-t border-border bg-surface">
          <div className="flex items-center gap-1 overflow-x-auto border-b border-border px-2 py-1">
            <ToolBtn icon="↶" label="Undo" hotkey="Ctrl+Z" disabled={!state?.canUndo || busy} onClick={() => undo.mutate()} />
            <ToolBtn icon="↷" label="Redo" hotkey="Ctrl+Y" disabled={!state?.canRedo || busy} onClick={() => redo.mutate()} />
            <span className="mx-1 h-6 w-px bg-border" />
            <ToolBtn icon="✂" label="Split" hotkey="S" disabled={busy} onClick={split} />
            <ToolBtn icon="⧉" label="Duplicate" disabled={!seg || busy} onClick={() => seg && doEdit([op.duplicate(seg.id)], "Duplicate")} />
            <ToolBtn icon="←" label="Earlier" disabled={!seg || segIdx <= 0 || busy} onClick={() => move(-1)} />
            <ToolBtn icon="→" label="Later" disabled={!seg || segIdx >= tl.segments.length - 1 || busy} onClick={() => move(1)} />
            <ToolBtn icon="🗑" label="Delete" hotkey="Del" danger disabled={!seg || tl.segments.length <= 1 || busy} onClick={remove} />
            <span className="mx-1 h-6 w-px bg-border" />
            <ToolBtn icon="T" label="Add text" onClick={() => openLibrary("text")} />
            <span className="ml-auto hidden text-[10px] text-muted md:block">Space play · S split · Del delete · drag a clip to move it · drag its edge to trim · Ctrl+scroll zoom</span>
          </div>
          <div className="px-2 pb-2 pt-1">
            <ProTimeline
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
                <Library tab={sheet} onTab={(t) => setSheet(t)} catalog={catalog.data}>
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
