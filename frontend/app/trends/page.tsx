"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dropzone } from "@/components/Dropzone";
import { ProgressBar } from "@/components/ProgressStages";
import { btnDanger, btnPrimary, btnSecondary, Card, EmptyState, ErrorBanner, PageHeader, Spinner } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { PICKER_VIDEO, isVideoFile } from "@/lib/format";
import type { LearnedTrend, TrendLook, TrendProfile } from "@/types/api";

const FIELD = "w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent";

/** The measurements in plain words (what an editor would say about the trend). */
function trendFacts(p: TrendProfile): string[] {
  const out: string[] = [];
  if (p.avgShot) out.push(`A cut every ${p.avgShot.toFixed(1)}s on average (${p.pace ?? "balanced"} pace)`);
  if (p.hookSeconds) out.push(`Hook: the first shot lasts ${p.hookSeconds.toFixed(1)}s`);
  if (p.onBeatShare !== undefined && p.bpm) out.push(`${Math.round(p.onBeatShare * 100)}% of cuts land on the beat (${Math.round(p.bpm)} BPM)`);
  if (p.loudAvgShot && p.calmAvgShot) out.push(`Loud parts ${p.loudAvgShot.toFixed(1)}s per shot, calm parts ${p.calmAvgShot.toFixed(1)}s`);
  else if (p.loudAvgShot) out.push(`Loud parts ${p.loudAvgShot.toFixed(1)}s per shot`);
  if (p.look?.brightness !== undefined && p.look.saturation !== undefined) {
    const light = p.look.brightness > 0.6 ? "bright" : p.look.brightness < 0.35 ? "dark, moody" : "balanced light";
    const colour = p.look.saturation > 0.45 ? "vivid colour" : p.look.saturation < 0.2 ? "muted colour" : "natural colour";
    out.push(`Look: ${light}, ${colour}`);
  }
  return out;
}

function looks(p: TrendProfile): TrendLook[] {
  return !p.described ? [] : Array.isArray(p.described) ? p.described : [p.described];
}

function LearnForm() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [pct, setPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const learn = useMutation({
    mutationFn: () => api.createReference(name.trim(), notes.trim(), files, setPct),
    onSuccess: () => {
      setName("");
      setNotes("");
      setFiles([]);
      setPct(0);
      qc.invalidateQueries({ queryKey: ["references"] });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const busy = learn.isPending;
  return (
    <Card className="space-y-4">
      <div>
        <h2 className="font-medium">Learn a new trend</h2>
        <p className="text-sm text-muted">
          Upload 1-6 trending Reels you like (saved to your phone or computer). The app measures how they are cut: timing on the beat, shot
          lengths in loud and calm parts, the hook and the look. The videos themselves are not kept.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Trend name</span>
          <input aria-label="Trend name" value={name} maxLength={80} disabled={busy} onChange={(e) => setName(e.target.value)} placeholder="e.g. Luxury jewellery Oct" className={FIELD} />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">What you like about it <span className="font-normal text-muted">(optional)</span></span>
          <input aria-label="Trend notes" value={notes} maxLength={300} disabled={busy} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. the fast zooms on the drop" className={FIELD} />
        </label>
      </div>
      <Dropzone
        label="Drop trending Reels here"
        hint="MP4, MOV, WEBM · up to 6 at a time"
        accept={PICKER_VIDEO}
        multiple
        disabled={busy}
        validate={isVideoFile}
        onReject={(n) => setError(`Not a video: ${n.join(", ")}`)}
        onFiles={(f) => {
          setError(null);
          setFiles((cur) => [...cur, ...f].slice(0, 6));
        }}
      />
      {files.length > 0 && (
        <ul className="space-y-1 text-sm" aria-label="Reels to learn from">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2">
              <span className="truncate">{f.name}</span>
              <button type="button" disabled={busy} className="text-xs text-muted hover:text-danger" onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <ErrorBanner title="Could not learn this trend" message={error} />}
      {busy && <ProgressBar value={pct * 100} label={pct < 1 ? "Uploading" : "Measuring the Reels"} />}
      {busy && pct >= 1 && <p className="text-xs text-muted">Measuring the cuts, the music and the look… about 10-30 s per Reel.</p>}
      <button type="button" className={btnPrimary} disabled={busy || !name.trim() || files.length === 0} onClick={() => { setError(null); learn.mutate(); }}>
        {busy ? "Learning…" : "Learn this trend"}
      </button>
    </Card>
  );
}

function TrendCard({ t }: { t: LearnedTrend }) {
  const qc = useQueryClient();
  const more = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(t.name);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["references"] });
  const add = useMutation({ mutationFn: (f: File[]) => api.addReferenceVideos(t.id, f), onSuccess: refresh, onError: (e) => setError(errorMessage(e)) });
  const rename = useMutation({ mutationFn: () => api.updateReference(t.id, { name: name.trim() }), onSuccess: () => { setEditing(false); refresh(); }, onError: (e) => setError(errorMessage(e)) });
  const remove = useMutation({ mutationFn: () => api.deleteReference(t.id), onSuccess: refresh, onError: (e) => setError(errorMessage(e)) });
  const dropVideo = useMutation({ mutationFn: (i: number) => api.removeReferenceVideo(t.id, i), onSuccess: refresh, onError: (e) => setError(errorMessage(e)) });
  const busy = add.isPending || rename.isPending || remove.isPending || dropVideo.isPending;
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        {editing ? (
          <div className="flex flex-1 gap-2">
            <input aria-label="New trend name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className={FIELD} />
            <button type="button" className={btnPrimary} disabled={!name.trim() || busy} onClick={() => rename.mutate()}>Save</button>
          </div>
        ) : (
          <div>
            <h3 className="font-medium">{t.name}</h3>
            <p className="text-xs text-muted">
              Learned from {t.videos.length} Reel{t.videos.length === 1 ? "" : "s"}{t.notes ? ` · “${t.notes}”` : ""}
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <input ref={more} type="file" hidden multiple accept={PICKER_VIDEO} onChange={(e) => { const f = Array.from(e.target.files ?? []).filter(isVideoFile); if (f.length) add.mutate(f.slice(0, 6)); e.target.value = ""; }} />
          <button type="button" className={btnSecondary} disabled={busy} onClick={() => more.current?.click()}>{add.isPending ? "Measuring…" : "Add Reels"}</button>
          {!editing && <button type="button" className={btnSecondary} disabled={busy} onClick={() => setEditing(true)}>Rename</button>}
          <button type="button" className={btnDanger} disabled={busy} onClick={() => remove.mutate()}>Delete</button>
        </div>
      </div>
      <ul className="space-y-1 text-sm" aria-label={`What ${t.name} does`}>
        {trendFacts(t.profile).map((f) => <li key={f}>• {f}</li>)}
      </ul>
      {looks(t.profile).some((l) => l.summary) && (
        <div className="rounded-xl bg-surface-2 p-3 text-sm">
          <p className="mb-1 text-xs font-medium text-muted">What the AI saw</p>
          {looks(t.profile).map((l, i) => l.summary && <p key={i}>{l.summary}{l.effects?.length ? ` Effects: ${l.effects.join(", ")}.` : ""}</p>)}
        </div>
      )}
      {t.videos.length > 1 && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer">The {t.videos.length} Reels</summary>
          <ul className="mt-2 space-y-1">
            {t.videos.map((v, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span className="truncate">{v.name || `Reel ${i + 1}`} · {v.seconds}s · {v.shots} shots · cut every {v.avgShot?.toFixed(1)}s</span>
                <button type="button" disabled={busy} className="hover:text-danger" onClick={() => dropVideo.mutate(i)}>Remove</button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {error && <ErrorBanner message={error} />}
    </Card>
  );
}

export default function TrendsPage() {
  const q = useQuery({ queryKey: ["references"], queryFn: api.references });
  return (
    <>
      <PageHeader title="My trends" subtitle="Show the AI trending Reels you like; it edits your videos with the same rhythm and feel." />
      <div className="space-y-6">
        <LearnForm />
        {q.isLoading && <Spinner label="Loading your trends…" />}
        {q.error && <ErrorBanner message={errorMessage(q.error)} />}
        {q.data && q.data.length === 0 && (
          <EmptyState title="No trends yet" hint="Learn one above. When you create a Reel, the AI picks the trend that fits your instructions, or you choose one." />
        )}
        {q.data?.map((t) => <TrendCard key={t.id} t={t} />)}
      </div>
    </>
  );
}
