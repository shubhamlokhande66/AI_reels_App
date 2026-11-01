"use client";

import { useState } from "react";
import { Button, Card, Heading, Icon } from "@/components/atoms";
import { cn } from "@/lib/cn";

/** Admin → Settings → Backup: the whole database as one file (server/backup.ts). MongoDB's free tier keeps no backups:
 * download one now and then (before a big change, once a week) and keep it somewhere safe; it holds the accounts and
 * their credits. */
const RESTORE = "MONGODB_URI=… node scripts/restore-backup.mjs shubix-backup-….ndjson";

export function BackupSettings({ bare = false }: { bare?: boolean }) {
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(""), [err, setErr] = useState(""), [copied, setCopied] = useState(false);
  const download = async () => {
    setBusy(true); setMsg(""); setErr("");
    try {
      const r = await fetch("/api/admin/backup", { credentials: "same-origin" });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error?.message ?? `The server answered ${r.status}.`);
      const blob = await r.blob(), name = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") ?? "")?.[1] ?? "shubix-backup.ndjson";
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      setMsg(`✓ Saved ${name} (${(blob.size / 1e6).toFixed(2)} MB).`);
    } catch (e) { setErr(e instanceof Error ? e.message : "The backup did not download."); }
    finally { setBusy(false); }
  };
  return (
    <Card as="section" aria-label="Backup" className={cn("flex flex-col gap-3", bare && "border-0 bg-transparent p-0 shadow-none md:p-0")}>
      <div className="flex flex-wrap items-start gap-3">
        {!bare && <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent"><Icon name="shield" size={19} /></span>}
        <div className="min-w-0 flex-1">
          {!bare && <Heading size="section" as="h2">Backup of the database</Heading>}
          <p className="m-0 text-[12.5px] text-muted">Everything in one file: accounts, credits and payments, settings, templates and the list of saved Reels (the videos stay in storage). MongoDB&apos;s free plan keeps no backups: download one now and then, and before any big change.</p>
        </div>
        <Button icon="download" loading={busy} onClick={download}>{busy ? "Preparing…" : "Download backup"}</Button>
      </div>
      {msg && <p className="m-0 text-[13px] font-semibold text-success">{msg}</p>}
      {err && <p className="m-0 text-[13px] text-danger">{err}</p>}
      <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface-2/50 p-3">
        <span className="text-[12px] font-semibold text-muted">To put a backup back (from the app&apos;s folder; add --replace to overwrite what is there)</span>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg bg-background px-3 py-2 font-[family-name:var(--font-geist-mono)] text-[12px]">{RESTORE}</code>
          <Button size="sm" variant="secondary" icon={copied ? "check" : "copy"} onClick={() => { void navigator.clipboard.writeText(RESTORE).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>{copied ? "Copied" : "Copy"}</Button>
        </div>
      </div>
    </Card>
  );
}
