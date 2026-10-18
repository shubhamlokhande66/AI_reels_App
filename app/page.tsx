"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, photoClass, Skeleton, Spinner, Thumb } from "@/components/atoms";
import { ErrorBanner, NotificationBell, ProBanner, ProPill, Scroller, SectionHeader, TipsBanner } from "@/components/molecules";
import { HomeHero } from "@/components/organisms/home/HomeHero";
import { ContinueSection, CreateSection, TemplatesSection, TipsSection } from "@/components/organisms/home/HomeSections";
import { useCredits, useFeatures, useMe, useProjects, useQueue } from "@/hooks/useApi";
import { linkOn } from "@/lib/features-list";
import { api, assetUrl, errorMessage } from "@/lib/api";
import { listCloudReels, type CloudReel } from "@/lib/cloudReels";
import { clock, useDrafts } from "@/lib/drafts";
import { styleLabel } from "@/lib/format";
import type { InsightGroup } from "@/types/api";

// Home (UI/ design "Shubix AI Reels Creator Dashboard"): the hero, Create Your Reel, Popular Templates, Continue
// Editing, Tips, Go Pro. With the server's parts on, what it is making and has made follows Continue Editing.

/** The step a running job is on, in plain words. */
function stageText(stage: string | undefined, progress: number): string {
  const s = (stage ?? "").toLowerCase();
  if (s.includes("queue") || s.includes("wait")) return "Waiting for a free spot…";
  if (s.includes("analy") || s.includes("beat")) return "Analysing beats…";
  if (s.includes("plan") || s.includes("direct")) return "Planning the cuts…";
  if (s.includes("caption")) return "Adding captions…";
  if (s.includes("render") || s.includes("export") || s.includes("encod")) return "Putting your Reel together…";
  if (stage) return `${stage[0].toUpperCase()}${stage.slice(1)}…`;
  return progress < 0.1 ? "Starting…" : "Working on it…";
}

/** The server's Reels: being made now, recently made, and what worked (only while a server part is on). */
function ServerActivity() {
  const projects = useProjects();
  const queue = useQueue();
  const stats = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard });
  const insights = useQuery({ queryKey: ["insights"], queryFn: api.insights });
  const list = projects.data ?? [];
  const d = stats.data;
  const jobs = new Map((queue.data ?? []).map((j) => [j.projectId, j]));
  const processing = list.filter((p) => p.status === "processing");

  if (projects.isLoading || stats.isLoading) return <Spinner label="Loading your Reels…" size="sm" />;
  return (
    <>
      {projects.error && <ErrorBanner message={errorMessage(projects.error)} onRetry={() => projects.refetch()} />}
      {stats.error && <ErrorBanner message={errorMessage(stats.error)} onRetry={() => stats.refetch()} />}

      {processing.length > 0 && (
        <section aria-labelledby="proc-h" className="flex flex-col gap-3">
          <SectionHeader id="proc-h" title="Being made now" href="/projects?status=processing" />
          <div className="flex flex-col gap-2.5 md:grid md:grid-cols-[repeat(auto-fit,minmax(260px,1fr))] md:gap-3">
            {processing.map((p) => {
              const job = jobs.get(p.id);
              const pct = Math.round(job?.progress ?? 0);
              return (
                <Link key={p.id} href={`/projects/${p.id}`} className="lr transition-colors hover:border-accent/60">
                  <Thumb id={p.id} url={p.thumbnailUrl} className="h-[60px] w-[46px] md:h-[70px] md:w-[70px]" />
                  <span className="meta">
                    <b>{p.name}</b>
                    <span className="mu xs">{job?.position ? `In line · number ${job.position}` : stageText(job?.stage, (job?.progress ?? 0) / 100)}</span>
                    <div className="bar">
                      <i style={{ width: `${Math.max(pct, 3)}%` }} />
                    </div>
                  </span>
                  <span className="mono sm mu">{pct}%</span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {d && d.recentlyGenerated.length > 0 && (
        <section aria-labelledby="made-h" className="flex flex-col gap-3">
          <SectionHeader id="made-h" title="Recently made" href="/projects?status=completed" />
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
            {d.recentlyGenerated.map((r) => (
              <li key={r.id} className="flex flex-col gap-1">
                <div className={`photo ${photoClass(r.projectId)} aspect-[9/16] rounded-2xl`}>
                  <video src={`${assetUrl(r.url)}#t=0.1`} preload="metadata" muted playsInline controls aria-label={`${r.projectName} ${r.label}`.trim()} />
                </div>
                <Link href={`/projects/${r.projectId}`} className="truncate text-[13px] font-bold hover:text-accent">
                  {r.projectName}
                </Link>
                <span className="truncate text-[11px] text-muted">{r.label || styleLabel(r.style)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {insights.data && insights.data.posts > 0 && (
        <section aria-labelledby="ins-h" className="flex flex-col gap-3">
          <SectionHeader id="ins-h" title="What worked for you" />
          <p className="m-0 text-[13px] text-muted">{insights.data.note}</p>
          <div className="grid gap-3 md:grid-cols-2">
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

function Group({ title, rows, label = (s: string) => s }: { title: string; rows: InsightGroup[]; label?: (s: string) => string }) {
  if (rows.length === 0) return null;
  return (
    <Card>
      <h3 className="h2 mb-2">{title}</h3>
      <ul className="space-y-1.5 text-sm">
        {rows.map((r) => (
          <li key={r.name} className="flex justify-between gap-2">
            <span>{label(r.name)}</span>
            <span className="mu text-right">
              {r.n} post{r.n === 1 ? "" : "s"} · {r.avgViews} views on average
              {r.avgCompletion !== null ? ` · ${Math.round(r.avgCompletion * 100)}% watched` : ""}
              {!r.confident && " · too few to be sure"}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function useSaved(on: boolean) {
  const [reels, setReels] = useState<CloudReel[] | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    listCloudReels().then(
      (d) => live && setReels(d.reels),
      () => live && setReels([]),
    );
    return () => {
      live = false;
    };
  }, [on]);
  return reels;
}

/** The Reels saved in My Reels (cloud), as a row. */
function SavedSection({ reels }: { reels: CloudReel[] | null }) {
  if (reels === null) return <Skeleton className="h-40 w-full" />;
  if (!reels.length) return null;
  return (
    <section aria-labelledby="saved-h" className="flex flex-col gap-3">
      <SectionHeader id="saved-h" title="Saved in My Reels" href="/reels?tab=saved" />
      <Scroller label="Saved Reels" grid="md:grid md:grid-cols-6 md:overflow-visible">
        {reels.slice(0, 6).map((r) => (
          <Link key={r.id} href="/reels?tab=saved" className="group flex w-[31vw] max-w-[150px] shrink-0 snap-start flex-col gap-1.5 md:w-auto md:max-w-none" title={r.name}>
            <div className="photo relative aspect-[9/16] w-full overflow-hidden rounded-2xl">
              {/* eslint-disable-next-line @next/next/no-img-element -- a small picture kept with the Reel */}
              {r.thumb && <img src={r.thumb} alt="" loading="lazy" className="h-full w-full object-cover" />}
              <span className="tag">{clock(r.dur)}</span>
            </div>
            <b className="truncate text-[13px] group-hover:text-accent">{r.name}</b>
          </Link>
        ))}
      </Scroller>
    </section>
  );
}

export default function Home() {
  const features = useFeatures();
  const me = useMe();
  const credits = useCredits();
  const [reload, setReload] = useState(0);
  const drafts = useDrafts(reload);
  const signedIn = !me.data?.authEnabled || !!me.data?.user;
  const saved = useSaved(signedIn);
  const server = linkOn("/projects", features); // the server's projects, jobs and insights only while a part that makes Reels there is on
  const create = linkOn("/projects/new", features) && features.aiReel ? { href: "/projects/new", reload: false } : { href: "/studio", reload: true };
  const plan = credits.data?.enabled ? credits.data.planName : null;
  const paid = credits.data?.enabled && credits.data.plan !== "free";

  return (
    <div className="flex flex-col gap-7 md:gap-9">
      {/* computers: the plan pill and the bell (phones have them in the top bar) */}
      <div className="-mb-4 hidden items-center justify-end gap-2 md:flex">
        <ProPill plan={plan} />
        <NotificationBell />
      </div>
      <HomeHero {...create} />
      <CreateSection features={features} />
      <TemplatesSection />
      <ContinueSection drafts={drafts} onChange={() => setReload((n) => n + 1)} />
      <TipsBanner />
      {server && <ServerActivity />}
      <SavedSection reels={saved} />
      <TipsSection />
      {!paid && <ProBanner />}
    </div>
  );
}
