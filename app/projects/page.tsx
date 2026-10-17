"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ProjectCard } from "@/components/molecules/ProjectCard";
import { Icon, LinkButton, Spinner } from "@/components/atoms";
import { EmptyState, ErrorBanner, PageHeader } from "@/components/molecules";
import { useProjects } from "@/hooks/useApi";
import { errorMessage } from "@/lib/api";
import type { ProjectStatus } from "@/types/api";

const FILTERS: { value: ProjectStatus | undefined; label: string }[] = [
  { value: undefined, label: "All" },
  { value: "processing", label: "Processing" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "draft", label: "Drafts" },
];
const VALID = new Set(["draft", "processing", "completed", "failed"]);

// Design: "My Projects" — status chips, a search, and the Reels as a grid of pictures.
function ProjectsList() {
  const params = useSearchParams();
  const raw = params.get("status");
  const status = raw && VALID.has(raw) ? (raw as ProjectStatus) : undefined;
  const [q, setQ] = useState(params.get("q") ?? "");
  const { data, isLoading, error, refetch } = useProjects(status);
  const needle = q.trim().toLowerCase();
  const shown = (data ?? []).filter((p) => !needle || p.name.toLowerCase().includes(needle));

  return (
    <div className="flex flex-col gap-3">
      <PageHeader title="My Projects" subtitle="Every Reel you've made or started." action={<LinkButton href="/projects/new" className="hidden md:inline-flex">+ New Reel</LinkButton>} />
      <nav aria-label="Filter by status" className="chips">
        {FILTERS.map((f) => (
          <Link
            key={f.label}
            href={f.value ? `/projects?status=${f.value}` : "/projects"}
            aria-current={f.value === status ? "true" : undefined}
            className={`chip ${f.value === status ? "on" : ""}`}
          >
            {f.label}
          </Link>
        ))}
      </nav>
      <label className="srch">
        <Icon name="search" size={16} />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects…" aria-label="Search projects" />
      </label>
      {isLoading && <Spinner />}
      {error && <ErrorBanner message={errorMessage(error)} onRetry={() => refetch()} />}
      {data && shown.length === 0 && (
        <EmptyState
          icon="projects"
          title={needle ? "Nothing matches your search" : status ? "Nothing here yet" : "No projects yet"}
          hint={needle ? "Try another word, or clear the search." : status ? "Try another filter, or make a new Reel." : "Add a few clips and a song to make your first Reel."}
          action={!needle ? <LinkButton href="/projects/new">Create a Reel</LinkButton> : undefined}
        />
      )}
      {shown.length > 0 && (
        <div className="grid grid-cols-3 gap-x-2 gap-y-2.5 sm:grid-cols-4 md:gap-x-3.5 md:gap-y-4 lg:grid-cols-6">
          {shown.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <ProjectsList />
    </Suspense>
  );
}
