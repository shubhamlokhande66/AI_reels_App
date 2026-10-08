"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, assetUrl, errorMessage } from "@/lib/api";
import { keys } from "@/hooks/useApi";
import { MAX_AUDIO_MB, MAX_VIDEO_MB, formatDuration, isAudioFile, isVideoFile, tooBig } from "@/lib/format";
import type { Project } from "@/types/api";
import { ProgressBar } from "@/components/ProgressStages";
import { ErrorBanner } from "@/components/ui";

/** The editor's media bin: the project's clips (click + to add one to the timeline) and its song; upload more. */
export function MediaBin({ project, busy, onAdd, onUploaded }: { project: Project; busy: boolean; onAdd: (clipId: string) => void; onUploaded: () => void }) {
  const qc = useQueryClient();
  const vInput = useRef<HTMLInputElement>(null);
  const aInput = useRef<HTMLInputElement>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clips = project.videos.filter((v) => !v.purged);

  async function upload(kind: "video" | "audio", files: File[]) {
    setError(null);
    const ok = files.filter(kind === "video" ? isVideoFile : isAudioFile);
    const big = tooBig(ok, kind === "video" ? MAX_VIDEO_MB : MAX_AUDIO_MB);
    if (big.length) return setError(`Too large: ${big.join(", ")}`);
    if (!ok.length) return setError(kind === "video" ? "Choose video files." : "Choose a music file.");
    setPct(0);
    try {
      if (kind === "video") await api.uploadVideos(project.id, ok, (f) => setPct(f * 100));
      else await api.uploadAudio(project.id, ok[0], (f) => setPct(f * 100));
      await qc.invalidateQueries({ queryKey: keys.project(project.id) });
      onUploaded();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPct(null);
    }
  }

  return (
    <div className="space-y-4">
      <input ref={vInput} type="file" accept="video/*" multiple hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; void upload("video", f); }} />
      <input ref={aInput} type="file" accept="audio/*" hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; void upload("audio", f); }} />
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Clips</h3>
        <button type="button" className="text-xs text-accent hover:underline" disabled={busy || pct !== null} onClick={() => vInput.current?.click()}>
          + Upload
        </button>
      </div>
      {pct !== null && <ProgressBar value={pct} label="Uploading" size="sm" />}
      {clips.length === 0 ? (
        <button type="button" onClick={() => vInput.current?.click()} className="w-full rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted hover:border-accent/60">
          Upload your clips to start
        </button>
      ) : (
        <ul className="grid grid-cols-2 gap-2">
          {clips.map((v) => (
            <li key={v.id} className="group relative overflow-hidden rounded-xl border border-border bg-surface-2">
              {v.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={assetUrl(v.thumbnailUrl)} alt="" className="aspect-video w-full object-cover" draggable={false} />
              ) : (
                <div className="aspect-video w-full" />
              )}
              <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[10px] text-white">{formatDuration(v.duration ?? 0)}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => onAdd(v.id)}
                title={`Add ${v.name} to the timeline`}
                className="lux-btn-gold absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full text-sm font-bold opacity-90 shadow group-hover:opacity-100"
              >
                +
              </button>
              <p className="truncate px-1.5 py-1 text-[11px] text-muted">{v.name}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between pt-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Music</h3>
        <button type="button" className="text-xs text-accent hover:underline" disabled={busy || pct !== null} onClick={() => aInput.current?.click()}>
          {project.audio ? "Change" : "+ Add song"}
        </button>
      </div>
      {project.audio ? (
        <p className="truncate rounded-xl border border-border px-3 py-2 text-xs">♬ {project.audio.name}</p>
      ) : (
        <p className="text-xs text-muted">No song yet: add one, or keep the clips&apos; own sound off.</p>
      )}
      {error && <ErrorBanner message={error} />}
    </div>
  );
}
