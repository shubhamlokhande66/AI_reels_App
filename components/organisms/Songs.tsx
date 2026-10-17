"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, assetUrl, errorMessage } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import type { Song } from "@/types/api";
import { btnPrimary, btnSecondary, Card, Icon, photoClass, Spinner } from "@/components/atoms";
import { EmptyState, ErrorBanner, PageHeader } from "@/components/molecules";

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
        Pick from my songs
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

type Sort = "recent" | "used" | "az";

/** The song library (design: "My songs"): search, sort, each song with a play button, upload and drop. */
function MySongs() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const list = useQuery({ queryKey: ["songs", q], queryFn: () => api.songs(q) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["songs"] });
  const [pct, setPct] = useState<number | null>(null);
  const up = useMutation({ mutationFn: (files: File[]) => api.uploadSongs(files, setPct), onSettled: () => setPct(null), onSuccess: refresh });
  const del = useMutation({ mutationFn: (id: string) => api.deleteSong(id), onSuccess: refresh });
  const scan = useMutation({ mutationFn: api.importSongs, onSuccess: refresh });
  const [asking, setAsking] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const songs = [...(list.data?.songs ?? [])];
  if (sort === "used") songs.sort((a, b) => b.useCount - a.useCount);
  if (sort === "az") songs.sort((a, b) => a.name.localeCompare(b.name));
  const addFiles = (files: File[]) => {
    const ok = files.filter((f) => f.type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i.test(f.name));
    if (ok.length) up.mutate(ok);
  };
  const play = (s: Song) => {
    const a = audio.current;
    if (!a) return;
    if (playing === s.id) {
      a.pause();
      setPlaying(null);
      return;
    }
    a.src = assetUrl(s.url) ?? "";
    void a.play();
    setPlaying(s.id);
  };

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title="My songs"
        subtitle="Upload a song once and use it in any Reel."
        action={
          <button type="button" className="btn g sm" disabled={pct !== null} onClick={() => input.current?.click()}>
            {pct !== null ? `${Math.round(pct * 100)}%` : "+ Upload"}
          </button>
        }
      />
      <input ref={input} type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac" multiple className="sr-only" tabIndex={-1} aria-label="Upload songs"
             onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      <audio ref={audio} onEnded={() => setPlaying(null)} className="hidden" />
      <label className="srch">
        <Icon name="search" size={16} />
        <input type="search" aria-label="Search songs" placeholder="Search by name or artist…" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <nav className="chips" aria-label="Sort">
        {([["recent", "Recent"], ["used", "Most used"], ["az", "A–Z"]] as const).map(([k, l]) => (
          <button key={k} type="button" className={`chip ${sort === k ? "on" : ""}`} aria-pressed={sort === k} onClick={() => setSort(k)}>
            {l}
          </button>
        ))}
        {list.data && list.data.folders.length > 0 && (
          <button type="button" className="chip" disabled={scan.isPending} onClick={() => scan.mutate()}>
            {scan.isPending ? "Checking…" : "Check my folders"}
          </button>
        )}
      </nav>
      {up.data && up.data.failed.length > 0 && <ErrorBanner message={`Not added: ${up.data.failed.map((f) => `${f.name} (${f.error})`).join("; ")}`} />}
      {scan.data && <p className="mu xs">{scan.data.added} new song{scan.data.added === 1 ? "" : "s"} added from your folders.</p>}
      {(up.error || del.error || list.error) && <ErrorBanner message={errorMessage(up.error || del.error || list.error)} />}
      {list.isLoading && <Spinner label="Loading your songs…" />}
      {list.data && songs.length === 0 && <EmptyState icon="music" title={q ? "No song matches" : "No songs yet"} hint={q ? "Try another name." : "Upload a song, or drop it below. Every song you use in a Reel is kept here too."} />}
      <ul className="flex flex-col gap-2">
        {songs.map((s) => (
          <li key={s.id} className="lr">
            <button type="button" aria-label={playing === s.id ? `Pause ${s.name}` : `Play ${s.name}`} onClick={() => play(s)} className={`photo ${photoClass(s.id)} grid h-12 w-12 shrink-0 place-items-center text-white`}>
              <Icon name={playing === s.id ? "pause" : "music"} size={18} />
            </button>
            <span className="meta">
              <b>{s.name}</b>
              <span className="mu sm truncate">
                {[s.artist ?? (s.source === "upload" ? "My upload" : "From my folder"), length(s.duration), s.useCount ? `used ${s.useCount}×` : null].filter(Boolean).join(" · ")}
                {s.license && (
                  <>
                    {" · "}
                    <a href={s.licenseUrl ?? undefined} target="_blank" rel="noreferrer" className="ac">{s.license}</a>
                  </>
                )}
              </span>
            </span>
            {asking === s.id ? (
              <span className="flex shrink-0 gap-1.5">
                <button type="button" className="btn sm danger fill" onClick={() => { del.mutate(s.id); setAsking(null); }}>Yes, delete</button>
                <button type="button" className="btn sm" onClick={() => setAsking(null)}>Keep</button>
              </span>
            ) : (
              <button type="button" className="ib plain" aria-label={`Delete ${s.name}`} onClick={() => setAsking(s.id)}>
                <Icon name="trash" size={18} />
              </button>
            )}
          </li>
        ))}
      </ul>
      <div
        className={`card items-center text-center ${over ? "!border-[var(--accent)]" : ""}`}
        style={{ borderStyle: "dashed" }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(Array.from(e.dataTransfer.files)); }}
      >
        <span className="mu sm">{pct !== null ? `Uploading… ${Math.round(pct * 100)}%` : "Drop MP3, M4A or WAV files here"}</span>
        <span className="mu xs">
          {list.data?.folders.length ? `New songs in ${list.data.folders.join(", ")} are added automatically. ` : ""}Every song you use in a Reel is kept here too.
        </span>
      </div>
    </div>
  );
}

export function SongsPage() {
  return <MySongs />;
}
