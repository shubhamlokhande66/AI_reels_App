"use client";

import { toast } from "@/lib/toast";
import { AdSlot } from "@/components/organisms/AdSlot";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { clock, deleteDraft, useDrafts, type Draft } from "@/lib/drafts";
import { formatRelative } from "@/lib/format";
import { megabytes, videoQuality } from "@shubix/utils";
import { useText } from "@/hooks/useApi";
import { confirmAction } from "@/components/molecules/ConfirmDialog";
import { MoreMenu } from "@/components/molecules/MoreMenu";
import { Badge, Button, Card, DurationTag, Icon, IconButton, Photo, Spinner } from "@/components/atoms";
import { EmptyState, ErrorBanner, PageHeader, Segmented } from "@/components/molecules";
import { cloudReelUrl, deleteCloudReel, listCloudReels, shareCloudReel, type CloudReel, type CloudUsage } from "@/lib/cloudReels";

/**
 * My Reels (like Instagram Edits' Projects): Drafts are the Reels being made, kept on this phone by Fast Studio (opened
 * there again exactly as they were); Saved are the finished Reels kept in the account with "Export & save" (watch,
 * download, share a link, delete). Only the Saved ones are on the server. Every text: Admin → CMS → My Reels.
 */

const GRID = "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 md:gap-4";

function MakeReel() {
  const text = useText();
  return <Button href="/create/music" reload icon="plus">{text("reels.makeReel")}</Button>;
}

/** a Reel's cover: the picture, its length, ▶ on hover */
function Cover({ thumb, dur }: { thumb?: string | null; dur?: number }) {
  return (
    <Photo className="aspect-[3/4] w-full rounded-2xl transition-transform duration-300 group-hover:-translate-y-0.5">
      {/* eslint-disable-next-line @next/next/no-img-element -- a small picture kept with the Reel */}
      {thumb && <img src={thumb} alt="" loading="lazy" />}
      <span className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
      <DurationTag className="bottom-2 left-2">{clock(dur ?? 0)}</DurationTag>
      <span className="absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm"><Icon name="play" size={18} /></span>
      </span>
    </Photo>
  );
}

function Drafts({ drafts, onGone }: { drafts: Draft[] | null; onGone: (id: string) => void }) {
  const text = useText();
  const [note, setNote] = useState<string | null>(null);
  const remove = async (d: Draft) => {
    if (!(await confirmAction({ title: text("reels.deleteDraftTitle", { name: d.name }), body: text("reels.deleteDraftText"), ok: text("reels.delete"), danger: true }))) return;
    try {
      await deleteDraft(d.id);
      onGone(d.id);
      setNote(text("reels.deleted", { name: d.name })); toast.success(text("reels.deleted", { name: d.name }));
    } catch {
      setNote(text("reels.deleteFailed"));
    }
    setTimeout(() => setNote(null), 3000);
  };
  if (drafts === null) return <Spinner />;
  if (!drafts.length) return <EmptyState icon="projects" title={text("reels.noDrafts")} hint={text("reels.noDraftsText")} action={<MakeReel />} />;
  return (
    <div className="flex flex-col gap-3">
      {note && <p role="status" className="m-0 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-[13px] font-semibold text-accent">{note}</p>}
      <div className={GRID}>
        {drafts.map((d) => {
          const href = `/editor?p=${encodeURIComponent(d.id)}`;
          return (
            <article key={d.id} className="group flex min-w-0 flex-col gap-2">
              <a href={href} title={text("reels.open", { name: d.name })}><Cover thumb={d.thumb} dur={d.dur} /></a>
              <div className="flex items-start gap-1">
                <a href={href} className="min-w-0 flex-1">
                  <b className="block truncate text-[13.5px] group-hover:text-accent">{d.name}</b>
                  <span className="flex items-center gap-1.5 text-[11.5px] text-muted">
                    {d.kind === "talk" && <Badge className="h-[18px] px-1.5 text-[10px]">{text("reels.talking")}</Badge>}
                    <span className="truncate">{text("reels.edited", { when: formatRelative(new Date(d.updated).toISOString()) })}</span>
                  </span>
                </a>
                <MoreMenu label={text("common.more")} items={[
                  { label: text("common.open"), icon: "scissors", href, reload: true },
                  { label: text("reels.delete"), icon: "trash", danger: true, onClick: () => void remove(d) },
                ]} />
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function SavedCard({ r, onChange, onDelete }: { r: CloudReel; onChange: (r: CloudReel) => void; onDelete: () => void }) {
  const text = useText();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const flash = (s: string) => { setNote(s); setTimeout(() => setNote(null), 2500); };
  const share = async () => {
    setBusy("share");
    try {
      const next = r.shared ? r : await shareCloudReel(r.id, true);
      onChange(next);
      const link = new URL(next.shareUrl!, location.origin).toString();
      if (navigator.share && matchMedia("(pointer: coarse)").matches) await navigator.share({ title: r.name, url: link }).catch(() => {});
      else { await navigator.clipboard.writeText(link); flash(text("reels.copied")); }
    } catch (e) {
      flash(e instanceof Error ? e.message : text("reels.failed"));
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    if (!(await confirmAction({ title: text("reels.deleteDraftTitle", { name: r.name }), body: text("reels.deleteSavedText"), ok: text("reels.delete"), danger: true }))) return;
    setBusy("delete");
    try { await deleteCloudReel(r.id); onDelete(); toast.success(text("reels.deleted", { name: r.name })); }
    catch (e) { flash(e instanceof Error ? e.message : text("reels.failed")); setBusy(null); }
  };
  return (
    <article className="group flex min-w-0 flex-col gap-2">
      <a href={cloudReelUrl(r.id)} target="_blank" rel="noreferrer" title={text("reels.watch", { name: r.name })} className="relative block">
        <Cover thumb={r.thumb} dur={r.dur} />
        {r.shared && <Badge tone="dark" className="absolute right-2 top-2"><Icon name="share" size={11} />{text("reels.linkOn")}</Badge>}
      </a>
      <div className="min-w-0">
        <b className="block truncate text-[13.5px]">{r.name}</b>
        <span className="block truncate text-[11.5px] text-muted">{videoQuality(r)} · {megabytes(r.size)}</span>
      </div>
      <div className="flex items-center gap-1 rounded-xl border border-border bg-surface p-1">
        <a href={cloudReelUrl(r.id, true)} aria-label={`${text("reels.download")} ${r.name}`} title={text("reels.download")}
          className="grid h-8 flex-1 place-items-center rounded-lg text-foreground transition-colors hover:bg-accent/10 hover:text-accent"><Icon name="download" size={15} /></a>
        <IconButton icon="share" plain size={32} iconSize={15} label={`${text("reels.share")}: ${r.name}`} title={text("reels.share")} disabled={!!busy} onClick={() => void share()} className="flex-1 rounded-lg hover:bg-accent/10" />
        <IconButton icon="trash" plain size={32} iconSize={15} label={`${text("reels.delete")} ${r.name}`} title={text("reels.delete")} disabled={!!busy} onClick={() => void remove()} className="flex-1 rounded-lg text-danger hover:bg-danger/10" />
      </div>
      {note && <span role="status" className="text-[11.5px] font-semibold text-accent">{note}</span>}
    </article>
  );
}

function Saved({ data, error, retry, setData }: { data: { reels: CloudReel[]; usage: CloudUsage } | null; error: string | null; retry: () => void; setData: React.Dispatch<React.SetStateAction<{ reels: CloudReel[]; usage: CloudUsage } | null>> }) {
  const text = useText();
  if (error) return <ErrorBanner message={error} onRetry={retry} />;
  if (!data) return <Spinner />;
  const { reels, usage } = data;
  const share = Math.min(100, (usage.used / Math.max(1, usage.limit)) * 100);
  return (
    <div className="flex flex-col gap-4">
      <Card aria-label={text("reels.spaceTitle")} className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-5">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <b className="text-[14px]">{text("reels.spaceTitle")}</b>
            <span className="text-[12.5px] text-muted">{text("reels.space", { used: usage.used, limit: usage.limit })}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div className={share > 85 ? "h-full rounded-full bg-warning" : "h-full rounded-full [background:var(--gold-gradient)]"} style={{ width: `${Math.max(share, usage.used ? 3 : 0)}%` }} />
          </div>
          {!!usage.keepDays && <p className="m-0 text-[11.5px] text-muted">{text("reels.keepDays", { days: usage.keepDays })}</p>}
        </div>
        <Button href="/pricing" size="sm" variant="secondary" icon="crown" className="self-start sm:self-center">{text("reels.moreSpace")}</Button>
      </Card>
      {!reels.length ? (
        <EmptyState icon="upload" title={text("reels.noSaved")} hint={text("reels.noSavedText")} action={<MakeReel />} />
      ) : (
        <div className={GRID}>
          {reels.map((r) => (
            <SavedCard key={r.id} r={r}
              onChange={(n) => setData((d) => d && { ...d, reels: d.reels.map((x) => (x.id === n.id ? n : x)) })}
              onDelete={() => setData((d) => d && { reels: d.reels.filter((x) => x.id !== r.id), usage: { ...d.usage, used: Math.max(0, d.usage.used - 1) } })} />
          ))}
        </div>
      )}
    </div>
  );
}

function MyReels() {
  const text = useText();
  const params = useSearchParams();
  const [tab, setTab] = useState<"drafts" | "saved">(params.get("tab") === "saved" ? "saved" : "drafts");
  const pick = (k: "drafts" | "saved") => { setTab(k); history.replaceState(null, "", k === "saved" ? "/reels?tab=saved" : "/reels"); };
  // both lists, so each tab shows its count
  const all = useDrafts();
  const [gone, setGone] = useState<string[]>([]);
  const drafts = all && all.filter((d) => !gone.includes(d.id));
  const qc = useQueryClient();
  const [saved, setSaved] = useState<{ reels: CloudReel[]; usage: CloudUsage } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let live = true;
    // always read fresh, but joined with the notification bell's read when both ask at once (one request, not two)
    qc.fetchQuery({ queryKey: ["cloud-reels"], queryFn: listCloudReels, staleTime: 0 }).then((d) => live && (setError(null), setSaved(d)), (e) => live && setError(e instanceof Error ? e.message : text("reels.failed")));
    return () => { live = false; };
  }, [tries]); // eslint-disable-line react-hooks/exhaustive-deps -- t only words the error

  const count = (n: number | undefined) => (n === undefined ? "" : <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 text-[11px] text-muted">{n}</span>);
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <PageHeader title={text("nav.reels")} subtitle={text("reels.sub")} desktopOnly action={<Button href="/create/music" reload icon="plus">{text("nav.newReel")}</Button>} />
      <AdSlot place="reels" />
      <Segmented label={text("nav.reels")} value={tab} onChange={pick} className="self-start"
        options={[{ value: "drafts", label: <>{text("reels.drafts")}{count(drafts?.length)}</> }, { value: "saved", label: <>{text("reels.saved")}{count(saved?.reels.length)}</> }]} />
      <div role="tabpanel">
        {tab === "drafts"
          ? <Drafts drafts={drafts} onGone={(id) => setGone((g) => [...g, id])} />
          : <Saved data={saved} error={error} retry={() => setTries((n) => n + 1)} setData={setSaved} />}
      </div>
    </div>
  );
}

export default function MyReelsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <MyReels />
    </Suspense>
  );
}
