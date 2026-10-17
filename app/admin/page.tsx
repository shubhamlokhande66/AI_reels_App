"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAdmin } from "@/hooks/useApi";
import { api, errorMessage } from "@/lib/api";
import { setAdminKey } from "@/lib/admin";
import Link from "next/link";
import { ErrorBanner, PageHeader } from "@/components/molecules";
import { RetentionSettings } from "@/components/organisms/RetentionSettings";
import { PricingSettings } from "@/components/organisms/PricingSettings";

/** Unlock (or leave) admin mode in this browser with the server's ADMIN_KEY. */
export default function AdminPage() {
  const qc = useQueryClient();
  const { admin, required, loading } = useAdmin();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!key.trim()) return setError("Enter the admin password.");
    setBusy(true);
    try {
      const s = await api.adminSession(key.trim());
      if (!s.admin) return setError("That password isn't right.");
      setAdminKey(key.trim());
      setKey("");
      await qc.invalidateQueries();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    setAdminKey(null);
    await qc.invalidateQueries();
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-3">
      <PageHeader title="Administration" subtitle="Settings and diagnostics are for the administrator." />
      <section className="card" style={{ gap: 12 }} aria-label="Admin sign-in">
        <span className="h2">Admin sign-in</span>
        {loading ? (
          <span className="mu sm">Checking…</span>
        ) : !required ? (
          <span className="mu sm">
            No admin key is set on this server, so admin mode is open to everyone (fine on your own computer). Online, set
            <code className="mx-1 rounded bg-surface-2 px-1">ADMIN_KEY</code> on the server.
          </span>
        ) : admin ? (
          <span className="sm">Admin mode is on in this browser: settings and checks are visible in the menu.</span>
        ) : (
          <form onSubmit={unlock} className="flex flex-col gap-3">
            <span className="mu sm">Settings and diagnostics are for the administrator.</span>
            <label className="f">
              Admin password
              <input type="password" autoComplete="current-password" placeholder="••••••••" value={key} onChange={(e) => setKey(e.target.value)} className="inp" />
            </label>
            {error && <ErrorBanner message={error} />}
            <button type="submit" className="btn g" disabled={busy}>
              {busy ? "Checking…" : "Sign in as admin"}
            </button>
          </form>
        )}
      </section>
      {admin && (
        <>
          <PricingSettings />
          <RetentionSettings />
          <div className="row sm justify-center" style={{ gap: 16 }}>
            <Link href="/settings" className="ac font-bold">
              AI settings
            </Link>
            <button type="button" className="ac font-bold" onClick={() => void leave()}>
              Leave admin mode
            </button>
          </div>
        </>
      )}
    </div>
  );
}
