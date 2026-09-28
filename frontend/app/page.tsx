"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ProjectCard } from "@/components/ProjectCard";
import { Card, EmptyState, ErrorBanner, LinkButton, PageHeader, Spinner } from "@/components/ui";
import { useProjects } from "@/hooks/useApi";
import { api, assetUrl, errorMessage } from "@/lib/api";
import { styleLabel } from "@/lib/format";
import type { InsightGroup, ProjectStatus } from "@/types/api";

const TILES: { status: ProjectStatus; label: string; tone: string }[] = [
  { status: "processing", label: "Processing", tone: "text-accent" },
  { status: "completed", label: "Completed", tone: "text-success" },
  { status: "failed", label: "Failed", tone: "text-danger" },
  { status: "draft", label: "Drafts", tone: "text-muted" },
];

export default function Dashboard() {
  const projects = useProjects();
  const stats = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard });
  const insights = useQuery({ queryKey: ["insights"], queryFn: api.insights });
  const list = projects.data ?? [];
  const processing = list.filter((p) => p.status === "processing");
  const d = stats.data;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Turn raw clips and a song into a beat-synced Reel."
        action={<LinkButton href="/projects/new">＋ New Project</LinkButton>}
      />

      {(projects.isLoading || stats.isLoading) && <Spinner />}
      {projects.error && <ErrorBanner message={errorMessage(projects.error)} onRetry={() => projects.refetch()} />}
      {stats.error && <ErrorBanner message={errorMessage(stats.error)} onRetry={() => stats.refetch()} />}

      {d && (
        <>
          <section aria-label="Project counts" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {TILES.map((t) => (
              <Link
                key={t.status}
                href={`/projects?status=${t.status}`}
                className="rounded-2xl border border-border bg-surface p-4 transition-colors hover:border-accent/60"
              >
                <p className="text-sm text-muted">{t.label}</p>
                <p className={`mt-1 text-3xl font-semibold tabular-nums ${t.tone}`}>{d.projects[t.status]}</p>
              </Link>
            ))}
          </section>

          <section aria-label="Workspace" className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Mini href="/templates" label="Templates" value={d.templates.total} />
            <Mini href="/voices" label="Voice profiles" value={d.voiceProfiles} />
            <Mini href="/brands" label="Brands" value={d.brands} />
            <Mini href="/library" label="Library clips" value={d.library.clips} hint={d.library.clips ? `${d.library.analyzed} analysed` : undefined} />
          </section>
        </>
      )}

      {processing.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">Processing</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {processing.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        </section>
      )}

      {d && d.recentlyGenerated.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">Recently generated</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {d.recentlyGenerated.map((r) => (
              <li key={r.id} className="rounded-2xl border border-border bg-surface p-2">
                <video src={assetUrl(r.url)} preload="metadata" muted playsInline controls className="aspect-[9/16] w-full rounded-xl bg-black" aria-label={`${r.projectName} ${r.label}`.trim()} />
                <Link href={`/projects/${r.projectId}`} className="mt-2 block truncate text-sm font-medium hover:text-accent">
                  {r.projectName}
                </Link>
                <p className="truncate text-xs text-muted">{r.label || styleLabel(r.style)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent Projects</h2>
          <Link href="/projects" className="text-sm text-accent hover:underline">
            View all
          </Link>
        </div>
        {projects.data && list.length === 0 ? (
          <EmptyState
            title="No projects yet"
            hint="Upload a few clips and a song to make your first Reel."
            action={<LinkButton href="/projects/new">Create your first Reel</LinkButton>}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {list.slice(0, 6).map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        )}
      </section>

      {d && (d.templates.favorites.length > 0 || d.mostUsedStyles.length > 0) && (
        <section className="mt-8 grid gap-4 md:grid-cols-2">
          {d.templates.favorites.length > 0 && (
            <Card>
              <h2 className="mb-2 font-semibold">Favorite templates</h2>
              <ul className="space-y-1 text-sm">
                {d.templates.favorites.map((t) => (
                  <li key={t.id}>
                    <Link href={`/projects/new?template=${t.id}`} className="hover:text-accent">
                      ★ {t.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {d.mostUsedStyles.length > 0 && (
            <Card>
              <h2 className="mb-2 font-semibold">Most used styles</h2>
              <ul className="space-y-1 text-sm">
                {d.mostUsedStyles.map((s) => (
                  <li key={s.style} className="flex justify-between">
                    <span>{styleLabel(s.style)}</span>
                    <span className="text-muted">{s.projects} project{s.projects === 1 ? "" : "s"}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      )}

      {insights.data && insights.data.posts > 0 && (
        <section className="mt-8" aria-label="Insights">
          <h2 className="mb-1 text-lg font-semibold">What worked for you</h2>
          <p className="mb-3 text-sm text-muted">{insights.data.note}</p>
          <div className="grid gap-4 md:grid-cols-2">
            <Group title="By style" rows={insights.data.byStyle} label={styleLabel} />
            <Group title="By length" rows={insights.data.byDuration} />
            <Group title="By captions" rows={insights.data.byCaptionStyle} />
            <Group title="Voice-over" rows={insights.data.byVoiceOver} />
          </div>
        </section>
      )}
    </>
  );
}

function Mini({ href, label, value, hint }: { href: string; label: string; value: number; hint?: string }) {
  return (
    <Link href={href} className="rounded-2xl border border-border bg-surface p-3 transition-colors hover:border-accent/60">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </Link>
  );
}

function Group({ title, rows, label = (s: string) => s }: { title: string; rows: InsightGroup[]; label?: (s: string) => string }) {
  if (rows.length === 0) return null;
  return (
    <Card>
      <h3 className="mb-2 font-medium">{title}</h3>
      <ul className="space-y-1 text-sm">
        {rows.map((r) => (
          <li key={r.name} className="flex justify-between gap-2">
            <span>{label(r.name)}</span>
            <span className="text-muted">
              {r.n} post{r.n === 1 ? "" : "s"} · avg {r.avgViews} views
              {r.avgCompletion !== null ? ` · ${Math.round(r.avgCompletion * 100)}% watched` : ""}
              {!r.confident && " · too few to trust"}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
