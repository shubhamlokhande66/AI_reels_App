"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useDeleteProject } from "@/hooks/useApi";
import { errorMessage } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import type { ProjectSummary } from "@/types/api";
import { Icon, StatusBadge, Thumb } from "@/components/atoms";
import { confirmAction } from "@/components/molecules/ConfirmDialog";

/** Delete right from the card: the pop-up asks first (never a single mis-tap). */
function CardDelete({ project }: { project: ProjectSummary }) {
  const qc = useQueryClient();
  const del = useDeleteProject();
  if (project.status === "processing") return null; // a running job must finish (or be cancelled) first
  const ask = async () => {
    if (!(await confirmAction({ title: `Delete "${project.name}"?`, body: "The Reel, its versions and its uploaded files are deleted from the server. This cannot be undone.", ok: "Delete", danger: true }))) return;
    del.mutate(project.id, { onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard"] }) });
  };
  return (
    <>
      <button
        type="button"
        aria-label={`Delete ${project.name}`}
        title="Delete this Reel"
        disabled={del.isPending}
        onClick={ask}
        className="absolute right-1.5 top-1.5 z-[2] grid h-8 w-8 place-items-center rounded-full bg-black/55 text-white opacity-100 transition-opacity hover:bg-[var(--danger)] sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
      >
        <Icon name="trash" size={15} />
      </button>
      {del.error && <span className="xs text-danger">{errorMessage(del.error)}</span>}
    </>
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
