"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ProjectCard } from "@/components/ProjectCard";
import { EmptyState, ErrorBanner, LinkButton, PageHeader, Spinner } from "@/components/ui";
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

function ProjectsList() {
  const raw = useSearchParams().get("status");
  const status = raw && VALID.has(raw) ? (raw as ProjectStatus) : undefined;
  const { data, isLoading, error, refetch } = useProjects(status);

  return (
    <>
      <PageHeader title="Projects" action={<LinkButton href="/projects/new">＋ New Project</LinkButton>} />
      <nav aria-label="Filter by status" className="mb-5 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.label}
            href={f.value ? `/projects?status=${f.value}` : "/projects"}
            aria-current={f.value === status ? "true" : undefined}
            className={`rounded-full border px-3 py-1 text-sm transition-colors ${
              f.value === status ? "border-accent bg-accent/15 text-foreground" : "border-border text-muted hover:text-foreground"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </nav>
      {isLoading && <Spinner />}
      {error && <ErrorBanner message={errorMessage(error)} onRetry={() => refetch()} />}
      {data && data.length === 0 && <EmptyState title="No projects here" hint="Try another filter or create a new project." />}
      {data && data.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}
    </>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <ProjectsList />
    </Suspense>
  );
}
