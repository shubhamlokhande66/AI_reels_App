"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { keys } from "@/hooks/useApi";
import { api, errorMessage } from "@/lib/api";
import type { EdlTimeline, Project, TimelineState } from "@/types/api";
import { btnSecondary, ErrorBanner } from "../ui";

const FIELD = "w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent disabled:opacity-50";
const AUDIO_MODES = [
  ["music", "Music only"],
  ["voice_music", "Voice-over + music"],
  ["voice", "Voice-over only"],
  ["original", "Original clip audio"],
  ["none", "No audio"],
] as const;

interface Props {
  project: Project;
  timeline: EdlTimeline;
  busy: boolean;
  onState: (s: TimelineState) => void;
}

/** Audio mode for the next render, and applying a brand (captions look, watermark, call to action) to this edit. */
export function BrandAudioPanel({ project, timeline, busy, onState }: Props) {
  const qc = useQueryClient();
  const brands = useQuery({ queryKey: ["brands"], queryFn: api.brands });
  const [brandId, setBrandId] = useState(project.settings.brandId ?? "");
  const mode = project.settings.audioMode ?? "music";

  const setMode = useMutation({
    mutationFn: (audioMode: (typeof AUDIO_MODES)[number][0]) => api.updateProject(project.id, { audioMode }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.project(project.id) }),
  });
  const apply = useMutation({
    mutationFn: () => api.applyBrand(project.id, brandId),
    onSuccess: (r) => {
      if (r.state) onState(r.state);
      qc.invalidateQueries({ queryKey: keys.project(project.id) });
    },
  });
  const error = setMode.error ?? apply.error;
  const note =
    (mode === "voice" || mode === "voice_music") && !timeline.voice
      ? "No voice-over yet: the render will use the music until you generate one."
      : null;

  return (
    <section aria-label="Audio and brand" className="space-y-3 rounded-2xl border border-border bg-surface p-4">
      <h3 className="font-medium">Audio &amp; brand</h3>
      <label className="block text-sm">
        <span className="mb-1 block text-xs text-muted">Audio for the next render</span>
        <select aria-label="Audio mode" className={FIELD} value={mode} disabled={busy || setMode.isPending} onChange={(e) => setMode.mutate(e.target.value as (typeof AUDIO_MODES)[number][0])}>
          {AUDIO_MODES.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        {note && <span className="mt-1 block text-xs text-warning">{note}</span>}
      </label>
      <div className="flex items-end gap-2">
        <label className="min-w-0 flex-1 text-sm">
          <span className="mb-1 block text-xs text-muted">Apply a brand to this edit</span>
          <select aria-label="Brand" className={FIELD} value={brandId} disabled={busy || apply.isPending} onChange={(e) => setBrandId(e.target.value)}>
            <option value="">Choose…</option>
            {brands.data?.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </label>
        <button type="button" className={btnSecondary} disabled={!brandId || busy || apply.isPending} onClick={() => apply.mutate()}>
          {apply.isPending ? "Applying…" : "Apply"}
        </button>
      </div>
      <p className="text-xs text-muted">A brand sets the caption look, adds your logo watermark and a call to action. Undo works as usual.</p>
      {timeline.watermark && <p className="text-xs text-success">✓ Watermark on</p>}
      {error && <ErrorBanner message={errorMessage(error)} />}
    </section>
  );
}
