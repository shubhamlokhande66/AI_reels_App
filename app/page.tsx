"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, Icon, LinkButton, photoClass, Spinner, Thumb } from "@/components/atoms";
import { EmptyState, ErrorBanner } from "@/components/molecules";
import { useFeatures, useMe, useProjects, useQueue } from "@/hooks/useApi";
import { linkOn } from "@/lib/features-list";
import { api, assetUrl, errorMessage } from "@/lib/api";
import { listCloudReels, type CloudReel } from "@/lib/cloudReels";
import { clock, useDrafts } from "@/lib/drafts";
import { styleLabel } from "@/lib/format";
import type { InsightGroup } from "@/types/api";

// Design: "Main" (phones) and "Desktop dashboard" — counts, the four ways to start, what is being made, recent Reels.
const STATS = [
  { key: "total", label: "Projects", desk: "Total projects", icon: "square", color: "#6fa8ff", href: "/projects" },
  { key: "processing", label: "Processing", icon: "refresh", color: "#d4b07a", href: "/projects?status=processing" },
  { key: "completed", label: "Completed", icon: "check", color: "#8fcf9f", href: "/projects?status=completed", stroke: 2.2 },
  { key: "failed", label: "Failed", icon: "warn", color: "#e88b7d", href: "/projects?status=failed" },
] as const;

const MAKE = [
  { href: "/projects/new", icon: "video", tile: "b1", title: "Edit my video clips", text: "Turn your clips into a Reel" },
  { href: "/projects/new?kind=product", icon: "bag", tile: "b2", title: "Product Reel", text: "From photos to stunning Reels" },
  { href: "/story/new", icon: "book", tile: "b3", title: "Story → Reel", text: "A narrated Reel from text" },
  { href: "/studio", icon: "bolt", tile: "b4", title: "Fast Studio", text: "Edit on your phone, no waiting", full: true },
];

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

function ServerDashboard() {
  const router = useRouter();
  const me = useMe();
  const features = useFeatures();
  const projects = useProjects();
  const queue = useQueue();
  const stats = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard });
  const insights = useQuery({ queryKey: ["insights"], queryFn: api.insights });
  const [q, setQ] = useState("");
  const [weekAgo] = useState(() => Date.now() - 7 * 86_400_000);
  const list = projects.data ?? [];
  const d = stats.data;
  const thisWeek = list.filter((p) => Date.parse(p.createdAt) > weekAgo).length;
  const jobs = new Map((queue.data ?? []).map((j) => [j.projectId, j]));
  const processing = list.filter((p) => p.status === "processing");
  const email = me.data?.user?.email;

  return (
    <div className="flex flex-col gap-[14px] md:gap-[22px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="h1">Dashboard</h1>
          <p className="sub">Turn raw clips and a song into a beat-synced Reel.</p>
        </div>
        <form
          role="search"
          className="hidden items-center gap-2.5 md:flex"
          onSubmit={(e) => {
            e.preventDefault();
            router.push(q.trim() ? `/projects?q=${encodeURIComponent(q.trim())}` : "/projects");
          }}
        >
          <label className="srch w-[300px]">
            <Icon name="search" size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your projects…" aria-label="Search your projects" />
          </label>
          <Link href="/account" aria-label="My account">
            <span className="avatar h-10 w-10">{(email?.[0] ?? "R").toUpperCase()}</span>
          </Link>
        </form>
      </div>

      {(projects.isLoading || stats.isLoading) && <Spinner />}
      {projects.error && <ErrorBanner message={errorMessage(projects.error)} onRetry={() => projects.refetch()} />}
      {stats.error && <ErrorBanner message={errorMessage(stats.error)} onRetry={() => stats.refetch()} />}

      {d && (
        <section aria-label="Your projects in numbers" className="g2 md:!grid-cols-[repeat(auto-fit,minmax(200px,1fr))] md:!gap-[14px]">
          {STATS.map((s) => (
            <Link key={s.key} href={s.href} className="stat transition-colors hover:border-accent/60">
              <b>{d.projects[s.key]}</b>
              <span className="ic" style={{ color: s.color }}>
                <Icon name={s.icon} size={16} stroke={"stroke" in s ? s.stroke : 2} />
              </span>
              <span className="mu sm">
                <span className="md:hidden">{s.label}</span>
                <span className="hidden md:inline">{"desk" in s ? s.desk : s.label}</span>
                {s.key === "total" && thisWeek > 0 && <span className="d hidden md:inline"> +{thisWeek} this week</span>}
              </span>
            </Link>
          ))}
        </section>
      )}

      <h2 className="ht">Create something new</h2>
      <section aria-label="Create something new" className="g2 md:!grid-cols-[repeat(auto-fit,minmax(200px,1fr))] md:!gap-[14px]">
        {MAKE.filter((m) => linkOn(m.href, features) && (m.href !== "/projects/new" || features.aiReel)).map((m, k, all) => {
          const inner = (
            <>
              <span className={`it ${m.tile}`}>
                <Icon name={m.icon} size={20} />
              </span>
              <span className="flex flex-col gap-0.5 md:!text-[#1a140c]">
                <b className="text-[14px] text-foreground md:text-[#1a140c]">{m.title}</b>
                <span className="text-[11.5px] leading-snug text-muted md:text-[12px] md:text-[#5e4518]">{m.text}</span>
              </span>
            </>
          );
          // an odd last tile takes the whole row on a phone (no half-empty row)
          const cls = `mk md:!flex-row md:!items-center md:!border-0 md:!bg-[linear-gradient(135deg,#f6e7c8,#e6cc98)] ${all.length % 2 && k === all.length - 1 ? "col-span-2 md:col-span-1" : ""}`;
          return m.full ? (
            <a key={m.href} href={m.href} className={cls}>
              {inner}
            </a>
          ) : (
            <Link key={m.href} href={m.href} className={cls}>
              {inner}
            </Link>
          );
        })}
      </section>

      {processing.length > 0 && (
        <>
          <div className="between">
            <h2 className="ht">Processing</h2>
            <Link href="/projects?status=processing" className="sm ac font-bold md:hidden">
              View all
            </Link>
          </div>
          <section aria-label="Being made now" className="flex flex-col gap-2.5 md:grid md:grid-cols-[repeat(auto-fit,minmax(240px,1fr))] md:gap-[14px]">
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
          </section>
        </>
      )}

      {d && d.recentlyGenerated.length > 0 && (
        <>
          <div className="between">
            <h2 className="ht">Recently generated</h2>
            <Link href="/projects?status=completed" className="ac sm font-bold">
              View all
            </Link>
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] md:gap-[14px]">
            {d.recentlyGenerated.map((r) => (
              <li key={r.id} className="flex flex-col gap-1">
                <div className={`photo ${photoClass(r.projectId)} aspect-[9/16]`}>
                  <video src={`${assetUrl(r.url)}#t=0.1`} preload="metadata" muted playsInline controls aria-label={`${r.projectName} ${r.label}`.trim()} />
                </div>
                <Link href={`/projects/${r.projectId}`} className="sm truncate font-bold hover:text-accent">
                  {r.projectName}
                </Link>
                <span className="mu xs truncate">{r.label || styleLabel(r.style)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {projects.data && list.length === 0 && (
        <EmptyState
          icon="video"
          title="No Reels yet"
          hint="Add a few clips and a song, and we'll cut your first Reel to the beat."
          action={<LinkButton href="/projects/new">Create your first Reel</LinkButton>}
        />
      )}

      {insights.data && insights.data.posts > 0 && (
        <section aria-label="What worked for you" className="flex flex-col gap-3">
          <div>
            <h2 className="ht">What worked for you</h2>
            <p className="sub">{insights.data.note}</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Group title="By style" rows={insights.data.byStyle} label={styleLabel} />
            <Group title="By length" rows={insights.data.byDuration} />
            <Group title="By captions" rows={insights.data.byCaptionStyle} />
            <Group title="Voice-over" rows={insights.data.byVoiceOver} />
          </div>
        </section>
      )}
    </div>
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

// ---- Home when the app is Fast Studio only (every server part off in Administration -> Features): no server counts or
// jobs, only what is made on the phone: start a Reel, the drafts on this phone, the Reels saved in My Reels.
const START = [
  { href: "/studio?kind=music", icon: "music", tile: "b1", title: "Music Reel", text: "Cuts land on every beat" },
  { href: "/studio?kind=talk", icon: "mic", tile: "b3", title: "Talking Reel", text: "Pauses cut, captions added" },
  { href: "/reels?tab=saved", icon: "video", tile: "b4", title: "My Reels", text: "Watch, download or share", page: true },
];

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

function StudioHome() {
  const me = useMe();
  const drafts = useDrafts();
  const saved = useSaved(!me.data?.authEnabled || !!me.data?.user);
  const name = me.data?.user?.email?.split("@")[0];
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const tile = (img: string | null | undefined, dur: number | undefined) => (
    <div className="photo relative aspect-[3/4] w-full overflow-hidden transition-transform group-hover:scale-[1.01]">
      {/* eslint-disable-next-line @next/next/no-img-element -- a small picture kept with the Reel */}
      {img && <img src={img} alt="" loading="lazy" className="h-full w-full object-cover" />}
      <span className="tag">{clock(dur)}</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-[14px] md:gap-[22px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eb">
            {hello}
            {name ? `, ${name}` : ""}
          </p>
          <h1 className="h1">What are we making today?</h1>
          <p className="sub">Your song and clips become a Reel in seconds, right on your phone.</p>
        </div>
      </div>

      <section aria-label="Start a Reel" className="g2 md:!grid-cols-[repeat(auto-fit,minmax(200px,1fr))] md:!gap-[14px]">
        {START.map((m) => {
          const inner = (
            <>
              <span className={`it ${m.tile}`}>
                <Icon name={m.icon} size={20} />
              </span>
              <span className="flex flex-col gap-0.5">
                <b className="text-[14px] text-foreground">{m.title}</b>
                <span className="text-[11.5px] leading-snug text-muted md:text-[12px]">{m.text}</span>
              </span>
            </>
          );
          return m.page ? (
            <Link key={m.href} href={m.href} className="mk col-span-2 !flex-row !items-center md:col-span-1 md:!flex-col md:!items-start">
              {inner}
            </Link>
          ) : (
            <a key={m.href} href={m.href} className="mk">
              {inner}
            </a>
          );
        })}
      </section>

      <div className="between">
        <h2 className="ht">Continue editing</h2>
        {!!drafts?.length && (
          <Link href="/reels" className="sm ac font-bold">
            View all
          </Link>
        )}
      </div>
      {drafts === null ? (
        <Spinner />
      ) : drafts.length ? (
        <div className="grid grid-cols-3 gap-x-2 gap-y-2.5 sm:grid-cols-4 md:gap-x-3.5 md:gap-y-4 lg:grid-cols-6">
          {drafts.slice(0, 6).map((d) => (
            <a key={d.id} href={`/studio?p=${encodeURIComponent(d.id)}`} className="group flex flex-col gap-1" title={`Open ${d.name}`}>
              {tile(d.thumb, d.dur)}
              <b className="sm truncate group-hover:text-accent">{d.name}</b>
            </a>
          ))}
        </div>
      ) : (
        <EmptyState
          icon="video"
          title="No Reels yet"
          hint="Pick a song and a few clips: your first Reel is ready in seconds, cut to the beat."
          action={
            <a href="/studio" className="btn g">
              Make your first Reel
            </a>
          }
        />
      )}

      {!!saved?.length && (
        <>
          <div className="between">
            <h2 className="ht">Saved in My Reels</h2>
            <Link href="/reels?tab=saved" className="sm ac font-bold">
              View all
            </Link>
          </div>
          <div className="grid grid-cols-3 gap-x-2 gap-y-2.5 sm:grid-cols-4 md:gap-x-3.5 md:gap-y-4 lg:grid-cols-6">
            {saved.slice(0, 6).map((r) => (
              <Link key={r.id} href="/reels?tab=saved" className="group flex flex-col gap-1" title={r.name}>
                {tile(r.thumb, r.dur)}
                <b className="sm truncate group-hover:text-accent">{r.name}</b>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function Home() {
  const features = useFeatures();
  // the server's dashboard (its projects, jobs and insights) only while a part that makes Reels there is on
  return linkOn("/projects", features) ? <ServerDashboard /> : <StudioHome />;
}
