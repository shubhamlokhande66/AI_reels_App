"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, assetUrl, errorMessage } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import type { Song } from "@/types/api";
import { btnPrimary, btnSecondary, Card, EmptyState, ErrorBanner, Spinner } from "./ui";

const INPUT = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
const SOURCE: Record<Song["source"], string> = { upload: "uploaded", folder: "from folder" };

const length = (s: number | null | undefined) => (s ? formatDuration(s) : "");

/** Pick a song from the library for a new Reel. The song becomes a File, so the waveform and upload work unchanged. */
export function SongPicker({ onPick, disabled }: { onPick: (file: File) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const list = useQuery({ queryKey: ["songs", q], queryFn: () => api.songs(q), enabled: open });
  const pick = useMutation({
    mutationFn: async (s: Song) => {
      const file = await api.songFile(s);
      api.songUsed(s.id).catch(() => undefined);
      return file;
    },
    onSuccess: (file) => {
      onPick(file);
      setOpen(false);
    },
  });
  if (!open) {
    return (
      <button type="button" className={btnSecondary} disabled={disabled} onClick={() => setOpen(true)}>
        ♬ Pick from my songs
      </button>
    );
  }
  return (
    <Card className="space-y-3" aria-label="My songs">
      <div className="flex gap-2">
        <input aria-label="Search my songs" className={INPUT} placeholder="Search my songs…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className={btnSecondary} onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      {list.isLoading && <Spinner label="Loading songs…" />}
      {list.error && <ErrorBanner message={errorMessage(list.error)} />}
      {pick.error && <ErrorBanner message={errorMessage(pick.error)} />}
      {list.data && list.data.songs.length === 0 && (
        <p className="text-sm text-muted">
          {q ? "No song matches." : "No songs yet. Every song you use is kept here; add more on the Songs page (upload, or a watched folder)."}
        </p>
      )}
      <ul className="max-h-72 divide-y divide-border overflow-y-auto">
        {list.data?.songs.map((s) => (
          <li key={s.id} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{s.name}</p>
              <p className="text-xs text-muted">
                {[s.artist, length(s.duration), SOURCE[s.source], s.license].filter(Boolean).join(" · ")}
              </p>
            </div>
            <audio controls preload="none" src={assetUrl(s.url)} className="h-8 w-40 shrink-0" />
            <button type="button" className={btnPrimary} disabled={pick.isPending} onClick={() => pick.mutate(s)}>
              {pick.isPending && pick.variables?.id === s.id ? "Loading…" : "Use"}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function MySongs() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const list = useQuery({ queryKey: ["songs", q], queryFn: () => api.songs(q) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["songs"] });
  const [pct, setPct] = useState<number | null>(null);
  const up = useMutation({ mutationFn: (files: File[]) => api.uploadSongs(files, setPct), onSettled: () => setPct(null), onSuccess: refresh });
  const del = useMutation({ mutationFn: (id: string) => api.deleteSong(id), onSuccess: refresh });
  const scan = useMutation({ mutationFn: api.importSongs, onSuccess: refresh });
  const [asking, setAsking] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <input aria-label="Search songs" className={`${INPUT} max-w-sm`} placeholder="Search by name or artist…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className={`${btnPrimary} cursor-pointer`}>
          {pct !== null ? `Uploading… ${Math.round(pct * 100)}%` : "Upload songs"}
          <input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac" multiple hidden aria-label="Upload songs"
                 onChange={(e) => e.target.files?.length && up.mutate(Array.from(e.target.files))} />
        </label>
        {list.data && list.data.folders.length > 0 && (
          <button type="button" className={btnSecondary} disabled={scan.isPending} onClick={() => scan.mutate()}>
            {scan.isPending ? "Checking…" : "Check folders now"}
          </button>
        )}
      </div>
      <p className="text-xs text-muted">
        {list.data?.folders.length
          ? `New songs in ${list.data.folders.join(", ")} are added automatically.`
          : "Tip: put SONG_IMPORT_FOLDERS=C:\\Users\\you\\Downloads in the backend .env and new songs there appear here automatically."}
        {" "}Every song you use in a Reel is kept here too.
      </p>
      {up.data && up.data.failed.length > 0 && <ErrorBanner message={`Not added: ${up.data.failed.map((f) => `${f.name} (${f.error})`).join("; ")}`} />}
      {scan.data && <p className="text-xs text-muted">{scan.data.added} new song{scan.data.added === 1 ? "" : "s"} imported.</p>}
      {(up.error || del.error || list.error) && <ErrorBanner message={errorMessage(up.error || del.error || list.error)} />}
      {list.isLoading && <Spinner label="Loading songs…" />}
      {list.data && list.data.songs.length === 0 && <EmptyState title={q ? "No song matches" : "No songs yet"} hint="Upload songs, or save them in a watched folder." />}
      <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
        {list.data?.songs.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{s.name}</p>
              <p className="text-xs text-muted">
                {[s.artist, length(s.duration), SOURCE[s.source], s.useCount ? `used ${s.useCount}×` : null].filter(Boolean).join(" · ")}
                {s.license && (
                  <>
                    {" · "}
                    <a href={s.licenseUrl ?? undefined} target="_blank" rel="noreferrer" className="text-accent hover:underline">{s.license}</a>
                  </>
                )}
              </p>
            </div>
            <audio controls preload="none" src={assetUrl(s.url)} className="h-8 w-56" />
            {asking === s.id ? (
              <span className="flex gap-2 text-xs">
                <button type="button" className="rounded-lg bg-danger px-3 py-1 text-white" onClick={() => { del.mutate(s.id); setAsking(null); }}>Yes, delete</button>
                <button type="button" className="rounded-lg border border-border px-3 py-1" onClick={() => setAsking(null)}>No</button>
              </span>
            ) : (
              <button type="button" aria-label={`Delete ${s.name}`} className="text-xs text-muted hover:text-danger" onClick={() => setAsking(s.id)}>Delete</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SongsPage() {
  return <MySongs />;
}
