"use client";

import Link from "next/link";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useDeleteProject } from "@/hooks/useApi";
import { errorMessage } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import type { ProjectSummary } from "@/types/api";
import { Icon, StatusBadge, Thumb } from "@/components/atoms";

/** Delete right from the card: one tap asks, a second tap confirms (never a single mis-tap). */
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
        title="Delete this Reel"
        onClick={() => setAsking(true)}
        className="absolute right-1.5 top-1.5 z-[2] grid h-8 w-8 place-items-center rounded-full bg-black/55 text-white opacity-100 transition-opacity hover:bg-[var(--danger)] sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
      >
        <Icon name="trash" size={15} />
      </button>
    );
  }
  return (
    <div role="group" aria-label={`Confirm deleting ${project.name}`} className="card absolute inset-x-1 top-1 z-[3] !gap-2 !p-2.5 text-xs">
      <b>Delete this Reel and its files?</b>
      {del.error && <span className="text-danger">{errorMessage(del.error)}</span>}
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={del.isPending}
          onClick={() => del.mutate(project.id, { onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard"] }) })}
          className="btn sm danger fill flex-1"
        >
          {del.isPending ? "Deleting…" : "Yes, delete"}
        </button>
        <button type="button" disabled={del.isPending} onClick={() => setAsking(false)} className="btn sm flex-1">
          Keep
        </button>
      </div>
    </div>
  );
}

/** A project in the grid (design: My Projects): its picture, name and state. */
export function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    // the delete controls sit beside the link (a button inside a link is invalid and would open the project)
    <div className="group relative">
      <Link href={`/projects/${project.id}`} className="flex flex-col gap-1" title={`${project.name} · ${project.duration} s · ${formatRelative(project.updatedAt)}`}>
        <Thumb id={project.id} url={project.thumbnailUrl} className="aspect-[3/4] w-full transition-transform group-hover:scale-[1.01]">
          <span className="tag">{project.duration} s</span>
        </Thumb>
        <b className="sm truncate group-hover:text-accent">{project.name}</b>
        <span className="self-start">
          <StatusBadge status={project.status} />
        </span>
      </Link>
      <CardDelete project={project} />
    </div>
  );
}
