"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { isVideoFile } from "@/lib/format";
import type { ReferenceReelInfo } from "@/types/api";
import { btnSecondary, ErrorBanner } from "./ui";

const MAX_MB = 300;

export function checkReferenceFile(f: File): string | null {
  if (!isVideoFile(f)) return "Choose a video file (MP4 or MOV).";
  if (f.size > MAX_MB * 1024 * 1024) return `The video is larger than ${MAX_MB} MB.`;
  return null;
}

function Facts({ r }: { r: ReferenceReelInfo }) {
  return (
    <p className="text-xs text-muted">
      {r.shots} shots in {r.seconds.toFixed(0)} s
      {r.avgShot ? ` · a cut every ${r.avgShot.toFixed(1)} s` : ""}
      {r.hookSeconds ? ` · ${r.hookSeconds.toFixed(1)} s hook` : ""}
      {r.onBeatShare != null ? ` · ${Math.round(r.onBeatShare * 100)}% on the beat` : ""}
    </p>
  );
}

/** The card's frame: gold outline and a clear invitation, so it is noticed (it decides the whole edit). */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <section
      aria-label="Make it like a Reel you love"
      className="relative overflow-hidden rounded-3xl border border-accent/50 bg-[linear-gradient(135deg,rgba(212,176,122,0.14),rgba(212,176,122,0.03))] p-5"
    >
      <div className="flex items-start gap-4">
        <span aria-hidden className="lux-btn-gold grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-xl">
          ✦
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <h2 className="font-display text-xl">Have a Reel you love? Make yours just like it</h2>
            <p className="text-sm text-muted">
              Add one trending Reel: your Reel gets the same cut timing, hook, beat sync and look, made with your own clips and song.
              Optional. Only its timing is kept, never the video.
            </p>
          </div>
          {children}
        </div>
      </div>
    </section>
  );
}

/** Before the project exists (step 1): only remembers the chosen file; it is studied when the clips are checked. */
export function ReferencePicker({ file, onFile, disabled }: { file: File | null; onFile: (f: File | null) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Frame>
      <input
        ref={input}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          const bad = checkReferenceFile(f);
          setError(bad);
          if (!bad) onFile(f);
        }}
      />
      {file ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-surface/70 px-3 py-2 text-sm">
          <span className="min-w-0 truncate">
            <span className="text-accent">✓</span> {file.name} <span className="text-xs text-muted">· studied when your clips are checked</span>
          </span>
          <span className="flex shrink-0 gap-2">
            <button type="button" className={`${btnSecondary} px-3 py-1.5 text-xs`} disabled={disabled} onClick={() => input.current?.click()}>
              Change
            </button>
            <button type="button" className={`${btnSecondary} px-3 py-1.5 text-xs`} disabled={disabled} onClick={() => onFile(null)}>
              Remove
            </button>
          </span>
        </div>
      ) : (
        <button type="button" className="lux-btn-gold rounded-full px-5 py-2.5 text-sm font-semibold" disabled={disabled} onClick={() => input.current?.click()}>
          + Add a Reel to copy
        </button>
      )}
      {error && <ErrorBanner title="This Reel cannot be used as a reference" message={error} />}
    </Frame>
  );
}

/** Once the project exists: upload / show / change / remove the project's reference Reel. */
export function ReferenceReel({ projectId, disabled, initialError }: { projectId: string; disabled?: boolean; initialError?: string | null }) {
  const qc = useQueryClient();
  const key = ["reference-reel", projectId];
  const q = useQuery({ queryKey: key, queryFn: () => api.referenceReel(projectId) });
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const upload = useMutation({
    mutationFn: (f: File) => api.setReferenceReel(projectId, f),
    onSuccess: (r) => qc.setQueryData(key, r),
    onError: (e) => setError(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.removeReferenceReel(projectId),
    onSuccess: () => qc.setQueryData(key, null),
  });
  const ref = q.data;

  return (
    <Frame>
      <input
        ref={input}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          setError(null);
          if (!f) return;
          const bad = checkReferenceFile(f);
          if (bad) return setError(bad);
          upload.mutate(f);
        }}
      />
      {ref ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface/70 px-3 py-2 text-sm">
          <div className="min-w-0">
            <p className="truncate font-medium">
              <span className="text-accent">✓</span> Following “{ref.name}”
            </p>
            <Facts r={ref} />
            {ref.summary && <p className="mt-0.5 text-xs text-muted">{ref.summary}</p>}
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" className={`${btnSecondary} px-3 py-1.5 text-xs`} disabled={disabled || upload.isPending} onClick={() => input.current?.click()}>
              {upload.isPending ? "Studying…" : "Change"}
            </button>
            <button type="button" className={`${btnSecondary} px-3 py-1.5 text-xs`} disabled={disabled || remove.isPending} onClick={() => remove.mutate()}>
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="lux-btn-gold rounded-full px-5 py-2.5 text-sm font-semibold"
          disabled={disabled || upload.isPending || q.isLoading}
          onClick={() => input.current?.click()}
        >
          {upload.isPending ? "Studying the Reel… (10-30 s)" : "+ Add a Reel to copy"}
        </button>
      )}
      {error && <ErrorBanner title="This Reel cannot be used as a reference" message={error} />}
    </Frame>
  );
}

/** A one-line reminder in the last step: the Reel will follow the reference chosen in step 1. */
export function ReferenceStatus({ projectId }: { projectId: string }) {
  const q = useQuery({ queryKey: ["reference-reel", projectId], queryFn: () => api.referenceReel(projectId) });
  if (!q.data) return null;
  return (
    <p className="rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-sm">
      <span className="text-accent">✦</span> Your Reel will follow <span className="font-medium">“{q.data.name}”</span>: {q.data.shots} shots, same cut timing
      and hook (change it in step 1).
    </p>
  );
}
