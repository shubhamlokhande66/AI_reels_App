"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon, Spinner, Thumb } from "@/components/atoms";
import { EmptyState, ErrorBanner, PageHeader } from "@/components/molecules";
import { useProjects } from "@/hooks/useApi";
import { api, errorMessage } from "@/lib/api";
import { formatDuration, isVideoFile, PICKER_VIDEO } from "@/lib/format";
import type { LibraryItem } from "@/types/api";
import { confirmAction } from "@/components/molecules/ConfirmDialog";

type Filter = "all" | "favorites" | "used";
const UPLOADS = "Library uploads"; // clips uploaded here live in a project of their own

// Design: "Media Library" — a search, filter chips, every clip as a picture, and the chosen clip's details.
export default function LibraryPage() {
  const qc = useQueryClient();
  const projects = useProjects();
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [ai, setAi] = useState(false);
  const [tag, setTag] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [picked, setPicked] = useState<string | null>(null);
  const [upload, setUpload] = useState<{ pct: number; note?: string } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const list = useQuery({
    queryKey: ["library", submitted, ai, tag, filter],
    queryFn: () =>
      submitted && ai
        ? api.librarySearch(submitted, true)
        : api.library({ q: submitted, tag, favorite: filter === "favorites" ? true : undefined, used: filter === "used" ? true : undefined }),
  });
  const patch = useMutation({
    mutationFn: (v: { id: string; favorite?: boolean; tags?: string[] }) => api.patchMedia(v.id, v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library"] }),
  });
  const remove = useMutation({
    mutationFn: (it: LibraryItem) => api.deleteVideo(it.projectId, it.id),
    onSuccess: () => { setPicked(null); void qc.invalidateQueries({ queryKey: ["library"] }); },
  });
  const askRemove = async (it: LibraryItem) => {
    if (await confirmAction({ title: `Delete "${it.name}"?`, body: `The clip is deleted from the server and from "${it.projectName}". Reels already made with it stay.`, ok: "Delete", danger: true })) remove.mutate(it);
  };
  const analyse = useMutation({
    mutationFn: (projectId: string) => api.analyze(projectId),
    onSuccess: () => setTimeout(() => qc.invalidateQueries({ queryKey: ["library"] }), 4000),
  });

  async function addClips(files: File[]) {
    setUploadError(null);
    const ok = files.filter(isVideoFile);
    if (!ok.length) return setUploadError("Those files aren't videos we can use. Try MP4, MOV or WEBM.");
    try {
      setUpload({ pct: 0 });
      let id = projects.data?.find((p) => p.name === UPLOADS)?.id;
      if (!id) id = (await api.createProject(UPLOADS, { duration: 30 })).id;
      const res = await api.uploadVideos(id, ok, (f) => setUpload({ pct: f }));
      setUpload({ pct: 1, note: "Looking at what's in your clips so you can search them…" });
      await api.analyze(id);
      await qc.invalidateQueries({ queryKey: ["library"] });
      await qc.invalidateQueries({ queryKey: ["projects"] });
      if (res.failed.length) setUploadError(`Skipped: ${res.failed.map((f) => `${f.name} (${f.error.message})`).join(", ")}`);
      setUpload(null);
      setTimeout(() => qc.invalidateQueries({ queryKey: ["library"] }), 5000);
    } catch (e) {
      setUpload(null);
      setUploadError(errorMessage(e));
    }
  }

  const items = list.data?.items ?? [];
  const chosen = items.find((i) => i.id === picked) ?? null;

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title="Media Library"
        subtitle="Every clip you've uploaded, searchable by what is in it."
        action={
          <button type="button" className="btn g sm" aria-label="Upload clips" disabled={!!upload} onClick={() => fileInput.current?.click()}>
            {upload ? `${Math.round(upload.pct * 100)}%` : "+ Upload"}
          </button>
        }
      />
      <input ref={fileInput} type="file" accept={PICKER_VIDEO} multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { void addClips(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      {upload && (
        <div className="card" aria-live="polite">
          <div className="row">
            <div className="bar flex-1">
              <i style={{ width: `${Math.max(3, upload.pct * 100)}%` }} />
            </div>
            <span className="mono sm">{Math.round(upload.pct * 100)}%</span>
          </div>
          <span className="mu sm">{upload.note ?? "Uploading your clips…"}</span>
        </div>
      )}
      {uploadError && <ErrorBanner message={uploadError} />}

      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(query.trim());
        }}
      >
        <label className="srch">
          <Icon name="search" size={16} />
          <input
            type="search"
            aria-label="Search clips"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!e.target.value) setSubmitted("");
            }}
            placeholder={ai ? "Describe it, e.g. close-ups of jewellery" : "Search “sunset”, “dancing”, “faces”…"}
          />
        </label>
      </form>

      <nav className="chips" aria-label="Filter">
        {(
          [
            ["all", "All"],
            ["favorites", "Favorites"],
            ["used", "Used in a Reel"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" className={`chip ${filter === k && !tag ? "on" : ""}`} onClick={() => { setFilter(k); setTag(""); }}>
            {l}
          </button>
        ))}
        <button type="button" className={`chip ${ai ? "on" : ""}`} aria-pressed={ai} onClick={() => setAi((v) => !v)} title="Search in plain words with AI">
          <Icon name="sparkle" size={14} />
          Smart search
        </button>
        {(list.data?.tags ?? []).slice(0, 12).map((t) => (
          <button key={t.tag} type="button" className={`chip ${t.tag === tag ? "on" : ""}`} onClick={() => setTag(t.tag === tag ? "" : t.tag)}>
            #{t.tag}
          </button>
        ))}
      </nav>

      {list.data?.note && <p role="status" className="card sm" style={{ color: "var(--warning)" }}>{list.data.note}</p>}
      {list.data?.terms && submitted && ai && <p className="mu xs">Looked for: {list.data.terms.join(", ")}</p>}
      {list.isLoading && <Spinner />}
      {list.error && <ErrorBanner message={errorMessage(list.error)} onRetry={() => list.refetch()} />}

      {list.data && items.length === 0 && (
        <EmptyState
          icon="image"
          title={submitted ? "No clips match" : "No clips yet"}
          hint={submitted ? "Try other words, or turn on Smart search." : "Upload clips here, or add them to a Reel: they all appear in your library."}
        />
      )}

      {items.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6" role="listbox" aria-label="Clips">
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              role="option"
              aria-selected={picked === it.id}
              aria-label={it.name}
              onClick={() => setPicked(picked === it.id ? null : it.id)}
              className={`relative rounded-[12px] ${picked === it.id ? "outline outline-2 outline-offset-2 outline-[var(--accent)]" : ""}`}
            >
              <Thumb id={it.id} url={it.thumbnailUrl} className="aspect-[3/4] w-full">
                <span className="tag">{formatDuration(it.duration)}</span>
                {it.favorite && (
                  <span className="absolute right-1.5 top-1.5 z-[1] text-[#f1dcb0]">
                    <Icon name="star" size={16} />
                  </span>
                )}
              </Thumb>
            </button>
          ))}
        </div>
      )}

      {chosen && (
        <ClipDetails
          key={chosen.id}
          item={chosen}
          analysing={analyse.isPending || (analyse.isSuccess && analyse.variables === chosen.projectId && !chosen.analyzed)}
          onAnalyse={() => analyse.mutate(chosen.projectId)}
          onFavorite={() => patch.mutate({ id: chosen.id, favorite: !chosen.favorite })}
          onTag={(tags) => patch.mutate({ id: chosen.id, tags })}
          onDelete={() => askRemove(chosen)}
          deleting={remove.isPending}
        />
      )}
      {remove.error && <ErrorBanner message={errorMessage(remove.error)} />}
      {analyse.error && <ErrorBanner message={errorMessage(analyse.error)} />}
    </div>
  );
}

/** The chosen clip (design: the card under the grid): its name, what is in it, tags, and Analyse. */
function ClipDetails({ item, analysing, onAnalyse, onFavorite, onTag, onDelete, deleting }: { item: LibraryItem; analysing: boolean; onAnalyse: () => void; onFavorite: () => void; onTag: (tags: string[]) => void; onDelete: () => void; deleting: boolean }) {
  const [draft, setDraft] = useState("");
  return (
    <section className="card" aria-label={`Clip ${item.name}`}>
      <div className="row">
        <Thumb id={item.id} url={item.thumbnailUrl} className="h-[52px] w-[52px]" />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <b className="sm truncate">{item.name}</b>
          <span className="chips w">
            {item.tags.length ? (
              item.tags.map((t) => (
                <span key={t} className="badge b-run">
                  {t}
                  {item.userTags.includes(t) && (
                    <button type="button" aria-label={`Remove tag ${t}`} onClick={() => onTag(item.userTags.filter((x) => x !== t))}>
                      <Icon name="close" size={10} stroke={2.6} />
                    </button>
                  )}
                </span>
              ))
            ) : (
              <span className="mu xs">{item.analyzed ? "No tags yet" : "Not looked at yet"}</span>
            )}
          </span>
        </span>
        {!item.analyzed ? (
          <button type="button" className="btn sm" disabled={analysing} onClick={onAnalyse}>
            {analysing ? "Analysing…" : "Analyse"}
          </button>
        ) : (
          <button type="button" className="ib plain" aria-pressed={item.favorite} aria-label={item.favorite ? "Remove from favorites" : "Add to favorites"} onClick={onFavorite}>
            <Icon name="star" size={20} color={item.favorite ? "#d4b07a" : undefined} />
          </button>
        )}
      </div>
      {item.summary && <span className="mu sm">{item.summary}</span>}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) onTag([...item.userTags, draft.trim()]);
          setDraft("");
        }}
      >
        <input aria-label="Add a tag" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a tag, e.g. beach" className="inp" />
        <button type="submit" className="btn sm shrink-0" disabled={!draft.trim()}>
          Add tag
        </button>
      </form>
      <div className="between mu xs">
        <Link href={`/projects/${item.projectId}`} className="truncate font-bold hover:text-accent">
          From: {item.projectName}
        </Link>
        <span>
          {item.used ? "Used in a Reel" : "Not used yet"}
          {item.score !== undefined ? ` · ${Math.round(item.score * 100)}% match` : ""}
        </span>
      </div>
      <div className="between">
        {item.analyzed ? (
          <button type="button" className="ac sm font-bold" onClick={onFavorite}>
            {item.favorite ? "Remove from favorites" : "Add to favorites"}
          </button>
        ) : <span />}
        <button type="button" className="btn sm danger" disabled={deleting} onClick={onDelete}>
          <Icon name="trash" size={15} />
          {deleting ? "Deleting…" : "Delete clip"}
        </button>
      </div>
    </section>
  );
}
