"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { btnPrimary, btnSecondary, Card, EmptyState, ErrorBanner, PageHeader, Spinner } from "@/components/ui";
import { api, assetUrl, errorMessage } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import type { LibraryItem } from "@/types/api";

type Tri = "all" | "yes" | "no";
const toBool = (v: Tri) => (v === "all" ? undefined : v === "yes");

export default function LibraryPage() {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [ai, setAi] = useState(false);
  const [tag, setTag] = useState("");
  const [favorite, setFavorite] = useState<Tri>("all");
  const [used, setUsed] = useState<Tri>("all");

  const list = useQuery({
    queryKey: ["library", submitted, ai, tag, favorite, used],
    queryFn: () =>
      submitted && ai
        ? api.librarySearch(submitted, true)
        : api.library({ q: submitted, tag, favorite: toBool(favorite), used: toBool(used) }),
  });
  const patch = useMutation({
    mutationFn: (v: { id: string; favorite?: boolean; tags?: string[] }) => api.patchMedia(v.id, v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library"] }),
  });

  const items = list.data?.items ?? [];
  const unanalysed = items.filter((i) => !i.analyzed).length;

  return (
    <>
      <PageHeader title="Media Library" subtitle="Every clip you have uploaded, searchable by what is in it." />

      <form
        role="search"
        className="mb-4 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(query.trim());
        }}
      >
        <input
          aria-label="Search clips"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={ai ? 'Ask in plain words, e.g. "close-up jewellery shots"' : "Search names, tags, objects…"}
          className="min-w-[14rem] flex-1 rounded-xl border border-border bg-surface px-3 py-2 outline-none focus:border-accent"
        />
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={ai} onChange={(e) => setAi(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
          AI search
        </label>
        <button type="submit" className={btnPrimary}>
          Search
        </button>
        {submitted && (
          <button
            type="button"
            className={btnSecondary}
            onClick={() => {
              setQuery("");
              setSubmitted("");
            }}
          >
            Clear
          </button>
        )}
      </form>

      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <Select label="Favorites" value={favorite} onChange={setFavorite} />
        <Select label="Used in a Reel" value={used} onChange={setUsed} />
        {tag && (
          <button type="button" className="rounded-full bg-accent/15 px-3 py-1 text-accent" onClick={() => setTag("")}>
            tag: {tag} ✕
          </button>
        )}
      </div>

      {list.data?.tags && list.data.tags.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-2" aria-label="Tags">
          {list.data.tags.slice(0, 16).map((t) => (
            <button
              key={t.tag}
              type="button"
              onClick={() => setTag(t.tag === tag ? "" : t.tag)}
              className={`rounded-full border px-2.5 py-0.5 text-xs ${t.tag === tag ? "border-accent bg-accent/15" : "border-border text-muted hover:text-foreground"}`}
            >
              {t.tag} <span className="opacity-60">{t.count}</span>
            </button>
          ))}
        </div>
      )}

      {list.data?.note && <p role="status" className="mb-4 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning">{list.data.note}</p>}
      {list.data?.terms && submitted && ai && (
        <p className="mb-4 text-xs text-muted">Searched for: {list.data.terms.join(", ")}</p>
      )}
      {list.isLoading && <Spinner />}
      {list.error && <ErrorBanner message={errorMessage(list.error)} onRetry={() => list.refetch()} />}
      {unanalysed > 0 && !submitted && (
        <p className="mb-4 text-sm text-muted">
          {unanalysed} clip{unanalysed === 1 ? " has" : "s have"} not been analysed yet. Open its project and choose <em>Analyse content</em> so it can be searched by what it shows.
        </p>
      )}

      {list.data && items.length === 0 && (
        <EmptyState title={submitted ? "No clips match" : "No clips yet"} hint={submitted ? "Try different words, or turn on AI search." : "Clips you upload to a project appear here."} />
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <ClipCard key={it.id} item={it} onFavorite={() => patch.mutate({ id: it.id, favorite: !it.favorite })} onTag={(tags) => patch.mutate({ id: it.id, tags })} />
        ))}
      </div>
    </>
  );
}

function Select({ label, value, onChange }: { label: string; value: Tri; onChange: (v: Tri) => void }) {
  return (
    <label className="flex items-center gap-2 text-muted">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Tri)}
        className="rounded-lg border border-border bg-surface px-2 py-1 text-foreground outline-none focus:border-accent"
      >
        <option value="all">All</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </label>
  );
}

function ClipCard({ item, onFavorite, onTag }: { item: LibraryItem; onFavorite: () => void; onTag: (tags: string[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const thumb = assetUrl(item.thumbnailUrl);
  return (
    <Card className="overflow-hidden !p-0">
      <div className="relative aspect-video bg-surface-2">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="grid h-full place-items-center text-sm text-muted">No preview</div>
        )}
        <button
          type="button"
          aria-pressed={item.favorite}
          aria-label={item.favorite ? `Remove ${item.name} from favorites` : `Add ${item.name} to favorites`}
          onClick={onFavorite}
          className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-1 text-lg leading-none"
        >
          {item.favorite ? "★" : "☆"}
        </button>
        <span className="absolute bottom-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-xs">{formatDuration(item.duration)}</span>
        <span className={`absolute bottom-2 right-2 rounded px-1.5 py-0.5 text-xs ${item.used ? "bg-success/30 text-success" : "bg-black/60 text-muted"}`}>
          {item.used ? "used" : "unused"}
        </span>
      </div>
      <div className="space-y-2 p-4">
        <p className="truncate font-medium" title={item.name}>
          {item.name}
        </p>
        {item.summary ? <p className="text-sm text-muted">{item.summary}</p> : <p className="text-sm text-muted/70">Not analysed yet.</p>}
        <div className="flex flex-wrap gap-1.5">
          {item.tags.map((t) => (
            <span key={t} className={`rounded-full px-2 py-0.5 text-xs ${item.userTags.includes(t) ? "bg-accent/20 text-accent" : "bg-surface-2 text-muted"}`}>
              {t}
              {item.userTags.includes(t) && (
                <button type="button" aria-label={`Remove tag ${t}`} className="ml-1 opacity-70" onClick={() => onTag(item.userTags.filter((x) => x !== t))}>
                  ✕
                </button>
              )}
            </span>
          ))}
          {adding ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (draft.trim()) onTag([...item.userTags, draft.trim()]);
                setDraft("");
                setAdding(false);
              }}
            >
              <input
                autoFocus
                aria-label="New tag"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => setAdding(false)}
                className="w-24 rounded-full border border-border bg-surface px-2 py-0.5 text-xs outline-none focus:border-accent"
              />
            </form>
          ) : (
            <button type="button" className="rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted hover:text-foreground" onClick={() => setAdding(true)}>
              + tag
            </button>
          )}
        </div>
        <div className="flex items-center justify-between text-xs text-muted">
          <Link href={`/projects/${item.projectId}`} className="truncate hover:text-accent">
            {item.projectName}
          </Link>
          {item.score !== undefined && <span>match {Math.round(item.score * 100)}%</span>}
        </div>
      </div>
    </Card>
  );
}
