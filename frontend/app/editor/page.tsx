"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, assetUrl, errorMessage } from "@/lib/api";
import { useProjects } from "@/hooks/useApi";
import { btnPrimary, Card, ErrorBanner, PageHeader, Spinner } from "@/components/ui";

const PRO = ["55 transitions", "22 effects", "20 filters", "Animated text", "Speed & slow motion", "Beat markers", "Captions", "HD export"];

/** The manual editor's start: a new edit from scratch, or open one of your Reels to edit it by hand. */
export default function EditorHome() {
  const router = useRouter();
  const projects = useProjects();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setError(null);
    setBusy(true);
    try {
      const p = await api.createProject(name.trim() || "My edit", { duration: 30 });
      router.push(`/editor/${p.id}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  const editable = (projects.data ?? []).filter((p) => p.videoCount > 0); // Reels made from clips (not stories / product photos)

  return (
    <>
      <PageHeader title="Editor" subtitle="Make a Reel yourself: every professional tool, free." />
      <Card className="space-y-4 border-accent/40 bg-[linear-gradient(135deg,rgba(212,176,122,0.12),transparent)]">
        <div>
          <h2 className="font-display text-2xl">Start a new edit</h2>
          <p className="mt-1 text-sm text-muted">Upload your clips and a song, then cut, arrange and style everything by hand. Nothing is automatic unless you ask.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRO.map((f) => (
            <span key={f} className="rounded-full border border-accent/30 px-2.5 py-1 text-[11px] text-accent">
              {f}
            </span>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name your edit (optional)"
            className="flex-1 rounded-xl border border-border bg-surface px-3 py-2.5 outline-none focus:border-accent"
          />
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => void create()}>
            {busy ? "Opening…" : "✦ Open the editor"}
          </button>
        </div>
        {error && <ErrorBanner message={error} />}
      </Card>

      <h2 className="mb-3 mt-10 font-medium">Or edit one of your Reels by hand</h2>
      {projects.isLoading ? (
        <Spinner label="Loading your projects…" />
      ) : editable.length === 0 ? (
        <p className="text-sm text-muted">Your Reels made from clips will appear here.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {editable.slice(0, 12).map((p) => (
            <li key={p.id}>
              <Link href={`/editor/${p.id}`} className="lux-card flex items-center gap-3 rounded-2xl p-3 transition-colors hover:border-accent/50">
                {p.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={assetUrl(p.thumbnailUrl)} alt="" className="h-16 w-12 shrink-0 rounded-lg object-cover" />
                ) : (
                  <span className="h-16 w-12 shrink-0 rounded-lg bg-surface-2" />
                )}
                <span className="min-w-0">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="text-xs text-accent">Open in editor →</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
