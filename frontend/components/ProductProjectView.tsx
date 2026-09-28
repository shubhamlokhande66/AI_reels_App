"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, assetUrl, errorMessage } from "@/lib/api";
import { formatBytes, formatDuration } from "@/lib/format";
import { keys, useDeleteProject } from "@/hooks/useApi";
import type { Project } from "@/types/api";
import { ProgressStages } from "./ProgressStages";
import { ShotList } from "./ShotList";
import { btnDanger, btnPrimary, btnSecondary, Card, ErrorBanner, PageHeader, Spinner, StatusBadge } from "./ui";

const FIELD = "w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60";
const newSeed = () => Math.floor(Math.random() * 1_000_000) + 1;

/** A product Reel project: the video, the director's shot list, and what can be changed before directing it again. */
export function ProductProjectView({ project }: { project: Project }) {
  const router = useRouter();
  const qc = useQueryClient();
  const del = useDeleteProject();
  const styles = useQuery({ queryKey: ["product-styles"], queryFn: api.productStyles, retry: false });
  const s = project.settings;
  const [style, setStyle] = useState(s.productStyle ?? "luxury_jewelry");
  const [hook, setHook] = useState(s.hookText ?? "");
  const [tagline, setTagline] = useState(s.taglineText ?? "");
  const [cta, setCta] = useState(s.ctaText ?? "");
  const [loop, setLoop] = useState(s.loop ?? false);

  const direct = useMutation({
    mutationFn: (v: { quality: "preview" | "final"; seed?: number; label?: string }) =>
      api.generateProduct(project.id, { productStyle: style, hookText: hook.trim(), taglineText: tagline.trim(), ctaText: cta.trim(), loop, quality: v.quality, seed: v.seed, label: v.label }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.project(project.id) }),
  });

  const images = project.images ?? [];
  const busy = project.status === "processing" || direct.isPending;
  const plan = project.productPlan ?? null;
  const previewNewer = project.preview && (!project.output || project.preview.createdAt > project.output.createdAt);
  const shown = previewNewer ? project.preview : project.output;

  return (
    <>
      <PageHeader
        title={project.name}
        subtitle={`Product Reel · ${images.length} photo${images.length === 1 ? "" : "s"} · ${s.duration}s`}
        action={<StatusBadge status={project.status} />}
      />
      {direct.error && (
        <div className="mb-4">
          <ErrorBanner message={errorMessage(direct.error)} />
        </div>
      )}

      {project.status === "processing" && (
        <Card>
          <h2 className="mb-4 font-semibold">Directing your Reel…</h2>
          {project.latestJob ? <ProgressStages job={project.latestJob} /> : <Spinner label="Starting…" />}
        </Card>
      )}

      {project.status === "failed" && (
        <div className="mb-4">
          <ErrorBanner title="The Reel could not be made" message={project.error?.message ?? "Something went wrong."} code={project.error?.code} />
        </div>
      )}

      {project.status !== "processing" && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_1fr]">
          <div className="mx-auto w-full max-w-[340px]">
            {shown ? (
              <>
                <video key={shown.id} src={assetUrl(shown.url)} controls playsInline preload="metadata" className="aspect-[9/16] w-full rounded-2xl border border-border bg-black" aria-label={previewNewer ? "Preview" : "Generated Reel"} />
                <p className="mt-2 text-xs text-muted">
                  {previewNewer ? "Fast preview (lower quality)" : "Final"} · {formatDuration(shown.duration)} · {shown.width}×{shown.height} · {formatBytes(shown.size)}
                </p>
                <a href={assetUrl(shown.downloadUrl)} download className={`${btnSecondary} mt-2 w-full`}>
                  Download MP4
                </a>
              </>
            ) : (
              <div className="grid aspect-[9/16] w-full place-items-center rounded-2xl border border-dashed border-border p-4 text-center text-sm text-muted">
                Nothing directed yet
              </div>
            )}
          </div>

          <div className="space-y-4">
            <Card className="space-y-4">
              <h2 className="font-semibold">Change and direct again</h2>
              <div role="radiogroup" aria-label="Product style" className="grid gap-2 sm:grid-cols-3">
                {(styles.data ?? []).map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    role="radio"
                    aria-checked={style === st.id}
                    disabled={busy}
                    onClick={() => setStyle(st.id)}
                    className={`rounded-xl border px-3 py-2 text-left text-sm ${style === st.id ? "border-accent bg-accent/10" : "border-border hover:border-accent/50"}`}
                  >
                    {st.name}
                  </button>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="text-xs text-muted">
                  Hook line
                  <input aria-label="Hook line" className={`${FIELD} mt-1`} value={hook} maxLength={80} disabled={busy} onChange={(e) => setHook(e.target.value)} />
                </label>
                <label className="text-xs text-muted">
                  Tagline
                  <input aria-label="Tagline" className={`${FIELD} mt-1`} value={tagline} maxLength={80} disabled={busy} onChange={(e) => setTagline(e.target.value)} />
                </label>
                <label className="text-xs text-muted">
                  Call to action
                  <input aria-label="Call to action" className={`${FIELD} mt-1`} value={cta} maxLength={80} disabled={busy} onChange={(e) => setCta(e.target.value)} />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={loop} disabled={busy} onChange={(e) => setLoop(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
                Make it loop
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btnPrimary} disabled={busy || images.length === 0} onClick={() => direct.mutate({ quality: "final", seed: newSeed(), label: "Directed again" })}>
                  {direct.isPending ? "Starting…" : "↻ Direct again"}
                </button>
                <button type="button" className={btnSecondary} disabled={busy || images.length === 0} onClick={() => direct.mutate({ quality: "preview", seed: 0, label: "Preview" })}>
                  Fast preview
                </button>
              </div>
              <p className="text-xs text-muted">Every direction is kept as a version. The same photos and settings always give the same Reel unless you direct again.</p>
            </Card>

            {images.length > 0 && (
              <Card>
                <h3 className="mb-2 font-medium">Photos</h3>
                <ul aria-label="Photos" className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {images.map((im) => (
                    <li key={im.id} className="overflow-hidden rounded-lg border border-border">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={assetUrl(im.thumbnailUrl ?? im.url)} alt={im.name} className="aspect-square w-full object-cover" />
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </div>
      )}

      {plan && project.status !== "processing" && (
        <div className="mt-10">
          <ShotList plan={plan} />
        </div>
      )}

      <div className="mt-10">
        <button
          type="button"
          className={btnDanger}
          disabled={busy || del.isPending}
          onClick={() => {
            if (window.confirm(`Delete "${project.name}" and all of its files?`)) del.mutate(project.id, { onSuccess: () => router.push("/projects") });
          }}
        >
          Delete project
        </button>
      </div>
    </>
  );
}
