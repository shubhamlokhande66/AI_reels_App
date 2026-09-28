"use client";

import Link from "next/link";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useDeleteProject } from "@/hooks/useApi";
import { assetUrl, errorMessage } from "@/lib/api";
import { formatRelative, styleLabel } from "@/lib/format";
import type { ProjectSummary } from "@/types/api";
import { StatusBadge } from "./ui";

/** Delete right from the card: one click asks, a second click confirms (never a single mis-click). */
function CardDelete({ project }: { project: ProjectSummary }) {
  const qc = useQueryClient();
  const del = useDeleteProject();
  const [asking, setAsking] = useState(false);
  if (project.status === "processing") return null; // a running job must finish (or be cancelled) first

  if (!asking) {
    return (
      <button
        type="button"
        aria-label={`Delete ${project.name}`}
        title="Delete project"
        onClick={() => setAsking(true)}
        className="absolute right-3 top-3 rounded-lg border border-border bg-surface/90 px-2 py-1 text-xs text-muted opacity-100 transition-opacity hover:border-danger/60 hover:text-danger sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
      >
        Delete
      </button>
    );
  }
  return (
    <div role="group" aria-label={`Confirm deleting ${project.name}`} className="absolute inset-x-3 top-3 rounded-xl border border-danger/40 bg-surface p-2 text-xs shadow-lg">
      <p className="font-medium">Delete this project and all its files?</p>
      {del.error && <p className="mt-1 text-danger">{errorMessage(del.error)}</p>}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={del.isPending}
          onClick={() => del.mutate(project.id, { onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard"] }) })}
          className="rounded-lg bg-danger px-3 py-1 font-medium text-white disabled:opacity-60"
        >
          {del.isPending ? "Deleting…" : "Yes, delete"}
        </button>
        <button type="button" disabled={del.isPending} onClick={() => setAsking(false)} className="rounded-lg border border-border px-3 py-1">
          No
        </button>
      </div>
    </div>
  );
}

export function ProjectCard({ project }: { project: ProjectSummary }) {
  const thumb = assetUrl(project.thumbnailUrl);
  return (
    // the delete controls sit beside the link (a button inside a link is invalid and would open the project)
    <div className="group relative overflow-hidden rounded-2xl border border-border bg-surface transition-colors hover:border-accent/60">
      <Link href={`/projects/${project.id}`} className="block">
        <div className="relative aspect-video bg-surface-2">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <div className="grid h-full place-items-center text-sm text-muted">No preview yet</div>
          )}
          <div className="absolute left-3 top-3">
            <StatusBadge status={project.status} />
          </div>
        </div>
        <div className="p-4">
          <p className="truncate font-medium group-hover:text-accent">{project.name}</p>
          <p className="mt-1 text-xs text-muted">
            {styleLabel(project.style)} · {project.duration}s · {project.videoCount} clip{project.videoCount === 1 ? "" : "s"}
          </p>
          <p className="mt-1 text-xs text-muted">{formatRelative(project.updatedAt)}</p>
        </div>
      </Link>
      <CardDelete project={project} />
    </div>
  );
}
