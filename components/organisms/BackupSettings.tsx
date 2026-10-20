"use client";

import { useState } from "react";
import { btnPrimary, Card } from "@/components/atoms";
import { adminHeaders } from "@/lib/admin";

/** Admin: the whole database as one file (server/backup.ts). MongoDB's free tier keeps no backups: download one now and
 * then (before a big change, once a week) and keep it somewhere safe; it holds the accounts and their credits. */
export function BackupSettings() {
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(""), [err, setErr] = useState("");
  const download = async () => {
    setBusy(true); setMsg(""); setErr("");
    try {
      const r = await fetch("/api/admin/backup", { headers: adminHeaders(), credentials: "same-origin" });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error?.message ?? `The server answered ${r.status}.`);
      const blob = await r.blob(), name = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") ?? "")?.[1] ?? "shubix-backup.ndjson";
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      setMsg(`Saved ${name} (${(blob.size / 1e6).toFixed(2)} MB).`);
    } catch (e) { setErr(e instanceof Error ? e.message : "The backup did not download."); }
    finally { setBusy(false); }
  };
  return (
    <Card>
      <h3 className="m-0 text-base font-semibold">Backup of the database</h3>
      <p className="mu sm m-0">Everything in one file: accounts, credits and payments, settings, templates, saved Reels (their list; the videos stay in storage). MongoDB&apos;s free plan keeps no backups, so download one now and then and keep it somewhere safe: it holds people&apos;s accounts.</p>
      <div className="mt-2"><button type="button" className={btnPrimary} disabled={busy} onClick={download}>{busy ? "Preparing…" : "Download backup"}</button></div>
      {msg && <p className="m-0 mt-2 text-sm text-success">{msg}</p>}
      {err && <p className="m-0 mt-2 text-sm text-danger">{err}</p>}
      <p className="mu xs m-0 mt-2">To put it back: <code>MONGODB_URI=… node scripts/restore-backup.mjs shubix-backup-….ndjson</code> (from the app&apos;s folder; existing documents are kept, add <code>--replace</code> to overwrite them).</p>
    </Card>
  );
}
