"use client";

import { AdSlot } from "@/components/organisms/AdSlot";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { clock, deleteDraft, useDrafts, type Draft } from "@/lib/drafts";
import { formatRelative } from "@/lib/format";
import { useT } from "@/hooks/useApi";
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

const mb = (b: number) => (b < 1e7 ? (b / 1e6).toFixed(1) : String(Math.round(b / 1e6))) + " MB";
const quality = (r: CloudReel) => (Math.min(r.width, r.height) >= 2000 ? "4K" : Math.min(r.width, r.height) >= 1000 ? "1080p" : "720p") + (r.fps > 30 ? ` · ${r.fps} fps` : "");
const GRID = "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 md:gap-4";

function MakeReel() {
  const t = useT();
  return <Button href="/create/music" reload icon="plus">{t("reels.makeReel")}</Button>;
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
  const t = useT();
  const [note, setNote] = useState<string | null>(null);
  const remove = async (d: Draft) => {
    if (!(await confirmAction({ title: t("reels.deleteDraftTitle", { name: d.name }), body: t("reels.deleteDraftText"), ok: t("reels.delete"), danger: true }))) return;
    try {
      await deleteDraft(d.id);
      onGone(d.id);
      setNote(t("reels.deleted", { name: d.name }));
    } catch {
      setNote(t("reels.deleteFailed"));
    }
    setTimeout(() => setNote(null), 3000);
  };
  if (drafts === null) return <Spinner />;
  if (!drafts.length) return <EmptyState icon="projects" title={t("reels.noDrafts")} hint={t("reels.noDraftsText")} action={<MakeReel />} />;
  return (
    <div className="flex flex-col gap-3">
      {note && <p role="status" className="m-0 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-[13px] font-semibold text-accent">{note}</p>}
      <div className={GRID}>
        {drafts.map((d) => {
          const href = `/create/edit?p=${encodeURIComponent(d.id)}`;
          return (
            <article key={d.id} className="group flex min-w-0 flex-col gap-2">
              <a href={href} title={t("reels.open", { name: d.name })}><Cover thumb={d.thumb} dur={d.dur} /></a>
              <div className="flex items-start gap-1">
                <a href={href} className="min-w-0 flex-1">
                  <b className="block truncate text-[13.5px] group-hover:text-accent">{d.name}</b>
                  <span className="flex items-center gap-1.5 text-[11.5px] text-muted">
                    {d.kind === "talk" && <Badge className="h-[18px] px-1.5 text-[10px]">{t("reels.talking")}</Badge>}
                    <span className="truncate">{t("reels.edited", { when: formatRelative(new Date(d.updated).toISOString()) })}</span>
                  </span>
                </a>
                <MoreMenu label={t("common.more")} items={[
                  { label: t("common.open"), icon: "scissors", href, reload: true },
                  { label: t("reels.delete"), icon: "trash", danger: true, onClick: () => void remove(d) },
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
  const t = useT();
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
      else { await navigator.clipboard.writeText(link); flash(t("reels.copied")); }
    } catch (e) {
      flash(e instanceof Error ? e.message : t("reels.failed"));
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    if (!(await confirmAction({ title: t("reels.deleteDraftTitle", { name: r.name }), body: t("reels.deleteSavedText"), ok: t("reels.delete"), danger: true }))) return;
    setBusy("delete");
    try { await deleteCloudReel(r.id); onDelete(); }
    catch (e) { flash(e instanceof Error ? e.message : t("reels.failed")); setBusy(null); }
  };
  return (
    <article className="group flex min-w-0 flex-col gap-2">
      <a href={cloudReelUrl(r.id)} target="_blank" rel="noreferrer" title={t("reels.watch", { name: r.name })} className="relative block">
        <Cover thumb={r.thumb} dur={r.dur} />
        {r.shared && <Badge tone="dark" className="absolute right-2 top-2"><Icon name="share" size={11} />{t("reels.linkOn")}</Badge>}
      </a>
      <div className="min-w-0">
        <b className="block truncate text-[13.5px]">{r.name}</b>
        <span className="block truncate text-[11.5px] text-muted">{quality(r)} · {mb(r.size)}</span>
      </div>
      <div className="flex items-center gap-1 rounded-xl border border-border bg-surface p-1">
        <a href={cloudReelUrl(r.id, true)} aria-label={`${t("reels.download")} ${r.name}`} title={t("reels.download")}
          className="grid h-8 flex-1 place-items-center rounded-lg text-foreground transition-colors hover:bg-accent/10 hover:text-accent"><Icon name="download" size={15} /></a>
        <IconButton icon="share" plain size={32} iconSize={15} label={`${t("reels.share")}: ${r.name}`} title={t("reels.share")} disabled={!!busy} onClick={() => void share()} className="flex-1 rounded-lg hover:bg-accent/10" />
        <IconButton icon="trash" plain size={32} iconSize={15} label={`${t("reels.delete")} ${r.name}`} title={t("reels.delete")} disabled={!!busy} onClick={() => void remove()} className="flex-1 rounded-lg text-danger hover:bg-danger/10" />
      </div>
      {note && <span role="status" className="text-[11.5px] font-semibold text-accent">{note}</span>}
    </article>
  );
}

function Saved({ data, error, retry, setData }: { data: { reels: CloudReel[]; usage: CloudUsage } | null; error: string | null; retry: () => void; setData: React.Dispatch<React.SetStateAction<{ reels: CloudReel[]; usage: CloudUsage } | null>> }) {
  const t = useT();
  if (error) return <ErrorBanner message={error} onRetry={retry} />;
  if (!data) return <Spinner />;
  const { reels, usage } = data;
  const share = Math.min(100, (usage.used / Math.max(1, usage.limit)) * 100);
  return (
    <div className="flex flex-col gap-4">
      <Card aria-label={t("reels.spaceTitle")} className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-5">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <b className="text-[14px]">{t("reels.spaceTitle")}</b>
            <span className="text-[12.5px] text-muted">{t("reels.space", { used: usage.used, limit: usage.limit })}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div className={share > 85 ? "h-full rounded-full bg-warning" : "h-full rounded-full [background:var(--gold-gradient)]"} style={{ width: `${Math.max(share, usage.used ? 3 : 0)}%` }} />
          </div>
          {!!usage.keepDays && <p className="m-0 text-[11.5px] text-muted">{t("reels.keepDays", { days: usage.keepDays })}</p>}
        </div>
        <Button href="/pricing" size="sm" variant="secondary" icon="crown" className="self-start sm:self-center">{t("reels.moreSpace")}</Button>
      </Card>
      {!reels.length ? (
        <EmptyState icon="upload" title={t("reels.noSaved")} hint={t("reels.noSavedText")} action={<MakeReel />} />
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
  const t = useT();
  const params = useSearchParams();
  const [tab, setTab] = useState<"drafts" | "saved">(params.get("tab") === "saved" ? "saved" : "drafts");
  const pick = (k: "drafts" | "saved") => { setTab(k); history.replaceState(null, "", k === "saved" ? "/reels?tab=saved" : "/reels"); };
  // both lists, so each tab shows its count
  const all = useDrafts();
  const [gone, setGone] = useState<string[]>([]);
  const drafts = all && all.filter((d) => !gone.includes(d.id));
  const [saved, setSaved] = useState<{ reels: CloudReel[]; usage: CloudUsage } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let live = true;
    listCloudReels().then((d) => live && (setError(null), setSaved(d)), (e) => live && setError(e instanceof Error ? e.message : t("reels.failed")));
    return () => { live = false; };
  }, [tries]); // eslint-disable-line react-hooks/exhaustive-deps -- t only words the error

  const count = (n: number | undefined) => (n === undefined ? "" : <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 text-[11px] text-muted">{n}</span>);
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <PageHeader title={t("nav.reels")} subtitle={t("reels.sub")} desktopOnly action={<Button href="/create/music" reload icon="plus">{t("nav.newReel")}</Button>} />
      <AdSlot place="reels" />
      <Segmented label={t("nav.reels")} value={tab} onChange={pick} className="self-start"
        options={[{ value: "drafts", label: <>{t("reels.drafts")}{count(drafts?.length)}</> }, { value: "saved", label: <>{t("reels.saved")}{count(saved?.reels.length)}</> }]} />
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
