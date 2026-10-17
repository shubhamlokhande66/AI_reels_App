"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { clock, useDrafts } from "@/lib/drafts";
import { Icon, Spinner } from "@/components/atoms";
import { EmptyState, ErrorBanner, PageHeader } from "@/components/molecules";
import { cloudReelUrl, deleteCloudReel, listCloudReels, shareCloudReel, type CloudReel, type CloudUsage } from "@/lib/cloudReels";

/**
 * My Reels (like Instagram Edits' Projects): Drafts are the Reels being made, kept on this phone by Fast Studio (opened
 * there again exactly as they were); Saved are the finished Reels kept in the account with "Export & save" (watch,
 * download, share a link, delete). Only the Saved ones are on the server.
 */

const mb = (b: number) => (b < 1e7 ? (b / 1e6).toFixed(1) : String(Math.round(b / 1e6))) + " MB";
const quality = (r: CloudReel) => (Math.min(r.width, r.height) >= 2000 ? "4K" : Math.min(r.width, r.height) >= 1000 ? "1080p" : "720p") + (r.fps > 30 ? ` · ${r.fps} fps` : "");

function Drafts() {
  const drafts = useDrafts();
  if (drafts === null) return <Spinner />;
  if (!drafts.length)
    return (
      <EmptyState
        icon="projects"
        title="No drafts yet"
        hint="The Reels you make in Fast Studio are kept on this phone and show up here."
        action={
          <a href="/studio" className="btn g">
            Make a Reel
          </a>
        }
      />
    );
  return (
    <div className="grid grid-cols-3 gap-x-2 gap-y-2.5 sm:grid-cols-4 md:gap-x-3.5 md:gap-y-4 lg:grid-cols-6">
      {drafts.map((d) => (
        <a key={d.id} href={`/studio?p=${encodeURIComponent(d.id)}`} className="group flex flex-col gap-1" title={`Open ${d.name} in Fast Studio`}>
          <div className="photo relative aspect-[3/4] w-full overflow-hidden transition-transform group-hover:scale-[1.01]">
            {/* eslint-disable-next-line @next/next/no-img-element -- a small picture kept on this phone */}
            {d.thumb && <img src={d.thumb} alt="" className="h-full w-full object-cover" />}
            <span className="tag">{clock(d.dur)}</span>
          </div>
          <b className="sm truncate group-hover:text-accent">{d.name}</b>
          <span className="xs text-muted">
            {d.kind === "talk" ? "Talking · " : ""}
            {new Date(d.updated).toLocaleDateString()}
          </span>
        </a>
      ))}
    </div>
  );
}

function SavedCard({ r, onChange, onDelete }: { r: CloudReel; onChange: (r: CloudReel) => void; onDelete: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const flash = (t: string) => {
    setNote(t);
    setTimeout(() => setNote(null), 2500);
  };
  const share = async () => {
    setBusy("share");
    try {
      const next = r.shared ? r : await shareCloudReel(r.id, true);
      onChange(next);
      const link = new URL(next.shareUrl!, location.origin).toString();
      if (navigator.share && matchMedia("(pointer: coarse)").matches) await navigator.share({ title: r.name, url: link }).catch(() => {});
      else {
        await navigator.clipboard.writeText(link);
        flash("Link copied");
      }
    } catch (e) {
      flash(e instanceof Error ? e.message : "That did not work. Please try again.");
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    setBusy("delete");
    try {
      await deleteCloudReel(r.id);
      onDelete();
    } catch (e) {
      flash(e instanceof Error ? e.message : "That did not work. Please try again.");
      setBusy(null);
    }
  };
  return (
    <div className="group relative flex flex-col gap-1">
      <a href={cloudReelUrl(r.id)} target="_blank" rel="noreferrer" className="photo relative block aspect-[3/4] w-full overflow-hidden" title={`Watch ${r.name}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- the Reel's small cover, kept with it */}
        {r.thumb && <img src={r.thumb} alt="" loading="lazy" className="h-full w-full object-cover" />}
        <span className="tag">{clock(r.dur)}</span>
        <span className="absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-black/55 text-white">
            <Icon name="play" size={18} />
          </span>
        </span>
      </a>
      <b className="sm truncate">{r.name}</b>
      <span className="xs text-muted">
        {quality(r)} · {mb(r.size)}
        {r.shared ? " · link on" : ""}
      </span>
      <div className="mt-0.5 flex gap-1">
        <a href={cloudReelUrl(r.id, true)} className="btn sm flex-1 !px-0" aria-label={`Download ${r.name}`} title="Download">
          <Icon name="download" size={15} />
        </a>
        <button type="button" onClick={share} disabled={!!busy} className="btn sm flex-1 !px-0" aria-label={`Share ${r.name}`} title="Share a link">
          <Icon name="share" size={15} />
        </button>
        <button type="button" onClick={() => setAsking(true)} disabled={!!busy} className="btn sm flex-1 !px-0" aria-label={`Delete ${r.name}`} title="Delete">
          <Icon name="trash" size={15} />
        </button>
      </div>
      {note && (
        <span role="status" className="xs text-accent">
          {note}
        </span>
      )}
      {asking && (
        <div role="group" aria-label={`Confirm deleting ${r.name}`} className="card absolute inset-x-1 top-1 z-[3] !gap-2 !p-2.5 text-xs">
          <b>Delete this Reel from My Reels?</b>
          <span className="text-muted">A copy you saved on your phone stays there.</span>
          <div className="flex gap-1.5">
            <button type="button" disabled={busy === "delete"} onClick={remove} className="btn sm danger fill flex-1">
              {busy === "delete" ? "Deleting…" : "Yes, delete"}
            </button>
            <button type="button" disabled={busy === "delete"} onClick={() => setAsking(false)} className="btn sm flex-1">
              Keep
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Saved() {
  const [data, setData] = useState<{ reels: CloudReel[]; usage: CloudUsage } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let live = true;
    listCloudReels().then(
      (d) => live && (setError(null), setData(d)),
      (e) => live && setError(e instanceof Error ? e.message : "That did not work. Please try again."),
    );
    return () => {
      live = false;
    };
  }, [tries]);
  const load = () => setTries((n) => n + 1);
  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (!data) return <Spinner />;
  const { reels, usage } = data;
  return (
    <div className="flex flex-col gap-3">
      <div className="card !gap-2 !p-3.5" aria-label="Space in My Reels">
        <div className="flex items-baseline justify-between gap-2">
          <b className="sm">
            {usage.used} of {usage.limit} Reels
          </b>
          <a href="/pricing" className="xs text-accent">
            More space
          </a>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--line,rgba(0,0,0,.08))]">
          <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.min(100, (usage.used / Math.max(1, usage.limit)) * 100)}%` }} />
        </div>
      </div>
      {!reels.length ? (
        <EmptyState
          icon="upload"
          title="Nothing saved yet"
          hint={'In Fast Studio, choose "Export & save to My Reels" to keep a finished Reel here, ready to watch, download or share from any phone.'}
          action={
            <a href="/studio" className="btn g">
              Make a Reel
            </a>
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-x-2 gap-y-3 sm:grid-cols-3 md:gap-x-3.5 md:gap-y-4 lg:grid-cols-5">
          {reels.map((r) => (
            <SavedCard
              key={r.id}
              r={r}
              onChange={(n) => setData((d) => d && { ...d, reels: d.reels.map((x) => (x.id === n.id ? n : x)) })}
              onDelete={() => setData((d) => d && { reels: d.reels.filter((x) => x.id !== r.id), usage: { ...d.usage, used: Math.max(0, d.usage.used - 1) } })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MyReels() {
  const params = useSearchParams();
  const [tab, setTab] = useState<"drafts" | "saved">(params.get("tab") === "saved" ? "saved" : "drafts");
  const pick = (t: "drafts" | "saved") => {
    setTab(t);
    history.replaceState(null, "", t === "saved" ? "/reels?tab=saved" : "/reels");
  };
  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title="My Reels"
        subtitle="Drafts stay on this phone. Saved Reels are kept in your account."
        action={
          <a href="/studio" className="btn g hidden md:inline-flex">
            + New Reel
          </a>
        }
      />
      <div role="tablist" aria-label="My Reels" className="chips">
        {(
          [
            ["drafts", "Drafts"],
            ["saved", "Saved"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => pick(k)} className={`chip ${tab === k ? "on" : ""}`}>
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel">{tab === "drafts" ? <Drafts /> : <Saved />}</div>
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
