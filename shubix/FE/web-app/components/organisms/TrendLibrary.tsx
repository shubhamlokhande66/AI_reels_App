"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dropzone } from "@/components/molecules/Dropzone";
import { ProgressBar } from "@/components/molecules/ProgressBar";
import { Badge, Button, Card, Heading, Icon, IconButton, Input, Select, Spinner } from "@/components/atoms";
import { EmptyState, ErrorBanner, Field, PageHeader, SidePanel } from "@/components/molecules";
import { confirmAction } from "@/components/molecules/ConfirmDialog";
import { StatTile } from "@/components/molecules/StatTile";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { PICKER_VIDEO, isVideoFile } from "@/lib/format";
import type { LearnedTrend, StyleSuggestion, TrendLook, TrendProfile } from "@/types/api";

/** The measurements in plain words (what an editor would say about the trend), each with its icon. */
function trendFacts(p: TrendProfile): [icon: string, text: string][] {
  const out: [string, string][] = [];
  if (p.avgShot) out.push(["scissors", `A cut every ${p.avgShot.toFixed(1)}s on average (${p.pace ?? "balanced"} pace)`]);
  if (p.hookSeconds) out.push(["bolt", `Hook: the first shot lasts ${p.hookSeconds.toFixed(1)}s`]);
  if (p.onBeatShare !== undefined && p.bpm) out.push(["music", `${Math.round(p.onBeatShare * 100)}% of cuts land on the beat (${Math.round(p.bpm)} BPM)`]);
  if (p.loudAvgShot && p.calmAvgShot) out.push(["wave", `Loud parts ${p.loudAvgShot.toFixed(1)}s per shot, calm parts ${p.calmAvgShot.toFixed(1)}s`]);
  else if (p.loudAvgShot) out.push(["wave", `Loud parts ${p.loudAvgShot.toFixed(1)}s per shot`]);
  if (p.look?.brightness !== undefined && p.look.saturation !== undefined) {
    const light = p.look.brightness > 0.6 ? "bright" : p.look.brightness < 0.35 ? "dark, moody" : "balanced light";
    const colour = p.look.saturation > 0.45 ? "vivid colour" : p.look.saturation < 0.2 ? "muted colour" : "natural colour";
    out.push(["palette", `Look: ${light}, ${colour}`]);
  }
  return out;
}

const looks = (p: TrendProfile): TrendLook[] => (!p.described ? [] : Array.isArray(p.described) ? p.described : [p.described]);

/** Learn a new trend: a name, a line, 1–6 Reels; it is measured, the videos are not kept. */
function LearnForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [pct, setPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const learn = useMutation({ meta: { success: "Learning started: Shubix is reading the Reel" },
    mutationFn: () => api.createReference(name.trim(), notes.trim(), files, setPct),
    onSuccess: () => { setName(""); setNotes(""); setFiles([]); setPct(0); qc.invalidateQueries({ queryKey: ["references"] }); onDone(); },
    onError: (e) => setError(errorMessage(e)),
  });
  const busy = learn.isPending;
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-[12.5px] text-muted">Upload 1–6 trending Reels you like. The app measures how they are cut: timing on the beat, shot lengths in loud and calm parts, the hook and the look. The videos themselves are not kept.</p>
      <Card className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Trend name"><Input aria-label="Trend name" value={name} maxLength={80} disabled={busy} onChange={(e) => setName(e.target.value)} placeholder="e.g. Luxury jewellery Oct" /></Field>
          <Field label="What you like about it (optional)"><Input aria-label="Trend notes" value={notes} maxLength={300} disabled={busy} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. the fast zooms on the drop" /></Field>
        </div>
        <Dropzone label="Drop trending Reels here" hint="MP4, MOV, WEBM · up to 6 at a time" accept={PICKER_VIDEO} multiple disabled={busy} validate={isVideoFile}
          onReject={(n) => setError(`Not a video: ${n.join(", ")}`)} onFiles={(f) => { setError(null); setFiles((cur) => [...cur, ...f].slice(0, 6)); }} />
        {files.length > 0 && (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label="Reels to learn from">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg border border-border bg-surface-2/50 px-3 py-2 text-[13px]">
                <Icon name="video" size={15} className="shrink-0 text-accent" />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <IconButton icon="close" size={28} iconSize={13} plain label={`Remove ${f.name}`} disabled={busy} onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      {error && <ErrorBanner title="Could not learn this trend" message={error} />}
      {busy && <ProgressBar value={pct * 100} label={pct < 1 ? "Uploading" : "Measuring the Reels"} showEta />}
      {busy && pct >= 1 && <p className="m-0 text-[12px] text-muted">Measuring the cuts, the music and the look… about 10–30 s per Reel.</p>}
      <Button icon="trend" loading={busy} disabled={!name.trim() || files.length === 0} onClick={() => { setError(null); learn.mutate(); }} className="self-end">
        {busy ? "Learning…" : "Learn this trend"}
      </Button>
    </div>
  );
}

function TrendCard({ t }: { t: LearnedTrend }) {
  const qc = useQueryClient();
  const more = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(t.name);
  const [showReels, setShowReels] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["references"] });
  const add = useMutation({ meta: { success: "Added" }, mutationFn: (f: File[]) => api.addReferenceVideos(t.id, f), onSuccess: refresh, onError: (e) => setError(errorMessage(e)) });
  const rename = useMutation({ meta: { success: "Renamed" }, mutationFn: () => api.updateReference(t.id, { name: name.trim() }), onSuccess: () => { setEditing(false); refresh(); }, onError: (e) => setError(errorMessage(e)) });
  const remove = useMutation({ meta: { success: "Removed" }, mutationFn: () => api.deleteReference(t.id), onSuccess: refresh, onError: (e) => setError(errorMessage(e)) });
  const dropVideo = useMutation({ meta: { success: "Video removed" }, mutationFn: (i: number) => api.removeReferenceVideo(t.id, i), onSuccess: refresh, onError: (e) => setError(errorMessage(e)) });
  const busy = add.isPending || rename.isPending || remove.isPending || dropVideo.isPending;
  const seen = looks(t.profile).filter((l) => l.summary);
  return (
    <Card as="article" aria-label={t.name} className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent"><Icon name="trend" size={19} /></span>
        {editing ? (
          <div className="flex min-w-0 flex-1 gap-2">
            <Input aria-label="New trend name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className="h-10" />
            <Button size="sm" className="h-10" disabled={!name.trim() || busy} onClick={() => rename.mutate()}>Save</Button>
            <Button size="sm" variant="ghost" className="h-10" onClick={() => { setEditing(false); setName(t.name); }}>Cancel</Button>
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Heading size="section" as="h3" className="truncate">{t.name}</Heading>
              {t.auto && <Badge tone="brand">Auto style</Badge>}
            </div>
            <p className="m-0 text-[12px] text-muted">Learned from {t.videos.length} Reel{t.videos.length === 1 ? "" : "s"}{t.notes ? ` · “${t.notes}”` : ""}</p>
          </div>
        )}
      </div>

      <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]" aria-label={`What ${t.name} does`}>
        {trendFacts(t.profile).map(([icon, f]) => (
          <li key={f} className="flex items-start gap-2"><Icon name={icon} size={15} className="mt-0.5 shrink-0 text-accent" />{f}</li>
        ))}
      </ul>

      {seen.length > 0 && (
        <div className="rounded-xl border border-border bg-surface-2/50 p-3 text-[13px]">
          <p className="m-0 mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-muted"><Icon name="eye" size={13} />What Shubix saw</p>
          {seen.map((l, i) => <p key={i} className="m-0">{l.summary}{l.effects?.length ? ` Effects: ${l.effects.join(", ")}.` : ""}</p>)}
        </div>
      )}

      {showReels && (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label={`The Reels of ${t.name}`}>
          {t.videos.map((v, i) => (
            <li key={i} className="flex items-center gap-2 rounded-lg border border-border bg-surface-2/50 px-3 py-2 text-[12px]">
              <Icon name="video" size={14} className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate">{v.name || `Reel ${i + 1}`} · {v.seconds}s · {v.shots} shots · cut every {v.avgShot?.toFixed(1)}s</span>
              {t.videos.length > 1 && <IconButton icon="close" size={26} iconSize={12} plain label={`Remove ${v.name || `Reel ${i + 1}`}`} disabled={busy} onClick={() => dropVideo.mutate(i)} />}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
        <input ref={more} type="file" hidden multiple accept={PICKER_VIDEO} onChange={(e) => { const f = Array.from(e.target.files ?? []).filter(isVideoFile); if (f.length) add.mutate(f.slice(0, 6)); e.target.value = ""; }} />
        <Button size="sm" variant="secondary" icon="plus" loading={add.isPending} disabled={busy} onClick={() => more.current?.click()}>{add.isPending ? "Measuring…" : "Add Reels"}</Button>
        <Button size="sm" variant="ghost" icon="video" onClick={() => setShowReels((v) => !v)}>{showReels ? "Hide Reels" : `${t.videos.length} Reel${t.videos.length === 1 ? "" : "s"}`}</Button>
        {!editing && <IconButton icon="pen" size={34} iconSize={15} plain label="Rename" disabled={busy} onClick={() => setEditing(true)} className="ml-auto" />}
        <IconButton icon="trash" size={34} iconSize={15} plain label="Delete" className={cn("text-danger", editing && "ml-auto")} disabled={busy}
          onClick={() => void confirmAction({ title: `Delete the trend “${t.name}”?`, body: "Its measurements are removed. Reels already made keep their edit.", ok: "Delete", danger: true }).then((ok) => ok && remove.mutate())} />
      </div>
      {error && <ErrorBanner message={error} />}
    </Card>
  );
}

const KINDS: [string, string][] = [["wedding", "Wedding"], ["travel", "Travel"], ["festival", "Festival"], ["dance", "Dance"], ["talking", "Talking"], ["product", "Product"],
  ["food", "Food"], ["fitness", "Fitness"], ["vlog", "Vlog"], ["birthday", "Birthday"], ["car", "Car & bike"], ["shop", "Shop & opening"], ["event", "Event & party"], ["other", "Other"]]; // server/studio/styles.ts CATEGORIES

function SuggestionRow({ s }: { s: StyleSuggestion }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState("");
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["style-suggestions"] });
  const use = useMutation({ mutationFn: () => api.useStyleSuggestion(s.id, kind), onSuccess: refresh, onError: (e) => setError(errorMessage(e)) });
  const remove = useMutation({ meta: { success: "Removed" }, mutationFn: () => api.removeStyleSuggestion(s.id), onSuccess: refresh, onError: (e) => setError(errorMessage(e)) });
  const busy = use.isPending || remove.isPending;
  return (
    <li className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-3">
      <div className="flex items-center gap-2">
        <Badge tone={s.from === "made" ? "success" : "brand"}>{s.from === "made" ? "Made & saved" : "Copied"}</Badge>
        <b className="min-w-0 flex-1 truncate text-[13.5px]">{s.name}</b>
      </div>
      <span className="text-[12px] text-muted">{s.dur}s{s.bpm ? ` · ${s.bpm} BPM` : ""} · {s.pace}{s.trans ? ` · ${s.trans}` : ""}</span>
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label={`Kind of Reel for ${s.name}`} value={kind} onChange={(e) => setKind(e.target.value)} className="h-9 min-w-0 flex-1 text-[13px]">
          <option value="">Kind of Reel…</option>
          {KINDS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
        </Select>
        <Button size="sm" loading={use.isPending} disabled={busy || !kind} onClick={() => { setError(null); use.mutate(); }}>Use</Button>
        <IconButton icon="trash" size={34} iconSize={15} plain label={`Remove ${s.name}`} className="text-danger" disabled={busy} onClick={() => { setError(null); remove.mutate(); }} />
      </div>
      {error && <ErrorBanner message={error} />}
    </li>
  );
}

/** Reels creators copied in the studio ("Copy a Reel") or made and saved: only their numbers are kept, never the video. Only the
 * administrator teaches the styles: each waits here until it is used (under a kind) or removed. */
function Suggestions() {
  const q = useQuery({ queryKey: ["style-suggestions"], queryFn: api.styleSuggestions });
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-[12.5px] text-muted">Reels people gave to “Copy a Reel” (Copied) and Reels they made and saved (Made &amp; saved). They never see this. Only the numbers are kept (pace, cuts, transitions, look), never the video. Pick the kind and tap Use to teach Shubix&apos;s styles with it, or remove it.</p>
      {q.isLoading && <Spinner size="sm" label="Loading…" />}
      {q.error && <ErrorBanner message={errorMessage(q.error)} />}
      {q.data && q.data.items.length === 0 && <EmptyState icon="check" title="Nothing waiting" hint="New Reels from people show up here." />}
      {q.data && q.data.items.length > 0 && <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Reels from users">{q.data.items.map((s) => <SuggestionRow key={s.id} s={s} />)}</ul>}
      {q.data && q.data.total > q.data.items.length && <p className="m-0 text-[12px] text-muted">Showing the newest {q.data.items.length} of {q.data.total}.</p>}
    </div>
  );
}

/** My trends (Admin → Tools → My trends, and /trends): the trends Shubix learned from Reels you gave it, and the Reels
 * people made or copied waiting to teach its styles. Learning and the waiting Reels open on the right. */
export function TrendLibrary({ embedded = false }: { embedded?: boolean } = {}) {
  const q = useQuery({ queryKey: ["references"], queryFn: api.references });
  const waiting = useQuery({ queryKey: ["style-suggestions"], queryFn: api.styleSuggestions });
  const [panel, setPanel] = useState<"learn" | "users" | null>(null);
  const trends = q.data ?? [], reels = trends.reduce((n, t) => n + t.videos.length, 0), waitingN = waiting.data?.total ?? 0;
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      {!embedded && <PageHeader title="My trends" subtitle="Give a trending Reel; its cuts, pace and look are learned." />}
      <div className="grid gap-2 sm:grid-cols-3 sm:gap-3">
        <StatTile icon="trend" label="Trends" value={trends.length} />
        <StatTile icon="video" label="Reels measured" value={reels} />
        <StatTile icon="user" label="Waiting from users" value={waitingN} />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={() => setPanel("learn")} aria-haspopup="dialog"
          className="flex items-center gap-3 rounded-2xl border border-accent/50 bg-[linear-gradient(120deg,color-mix(in_srgb,var(--accent)_14%,var(--surface)),var(--surface))] px-4 py-3.5 text-left shadow-[var(--shadow)] transition-colors hover:border-accent">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-on-accent [background:var(--gold-gradient)]"><Icon name="plus" size={19} /></span>
          <span className="min-w-0 flex-1"><Heading size="section" as="h2">Learn a new trend</Heading><span className="block truncate text-[12.5px] text-muted">Upload 1–6 Reels you like: their cuts, pace and look are learned</span></span>
          <Icon name="chevron" size={18} className="shrink-0 text-muted" />
        </button>
        <button type="button" onClick={() => setPanel("users")} aria-haspopup="dialog"
          className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3.5 text-left shadow-[var(--shadow)] transition-colors hover:border-accent/60">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent"><Icon name="user" size={19} /></span>
          <span className="min-w-0 flex-1"><Heading size="section" as="h2">Reels from users</Heading><span className="block truncate text-[12.5px] text-muted">Copied and made Reels waiting to teach the styles</span></span>
          {waitingN > 0 && <Badge tone="brand">{waitingN} waiting</Badge>}
          <Icon name="chevron" size={18} className="shrink-0 text-muted" />
        </button>
      </div>

      <div className="flex items-center justify-between gap-2.5">
        <Heading>Trend library</Heading>
        {q.data && <span className="text-[12.5px] text-muted">{trends.length} trend{trends.length === 1 ? "" : "s"}</span>}
      </div>
      {q.isLoading && <Spinner size="sm" label="Loading your trends…" />}
      {q.error && <ErrorBanner message={errorMessage(q.error)} />}
      {q.data && !trends.length && (
        <EmptyState icon="trend" title="No trends yet" hint="Learn one: when a Reel is made, Shubix picks the trend that fits." action={<Button icon="plus" onClick={() => setPanel("learn")}>Learn a new trend</Button>} />
      )}
      {trends.length > 0 && <div className="grid gap-3 lg:grid-cols-2">{trends.map((t) => <TrendCard key={t.id} t={t} />)}</div>}

      <SidePanel open={panel === "learn"} onClose={() => setPanel(null)} title="Learn a new trend" where="My trends"><LearnForm onDone={() => setPanel(null)} /></SidePanel>
      <SidePanel open={panel === "users"} onClose={() => setPanel(null)} title="Reels from users" where="My trends" badge={waitingN ? <Badge tone="brand">{waitingN} waiting</Badge> : undefined}><Suggestions /></SidePanel>
    </div>
  );
}
