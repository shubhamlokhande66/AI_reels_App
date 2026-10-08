"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAdmin } from "@/hooks/useApi";
import { api, errorMessage } from "@/lib/api";
import { setAdminKey } from "@/lib/admin";
import { btnPrimary, btnSecondary, Card, ErrorBanner, PageHeader } from "@/components/ui";
import { RetentionSettings } from "@/components/RetentionSettings";
import { PricingSettings } from "@/components/PricingSettings";

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
    if (!key.trim()) return setError("Enter the admin key.");
    setBusy(true);
    try {
      const s = await api.adminSession(key.trim());
      if (!s.admin) return setError("That key is not correct.");
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
    <>
      <PageHeader title="Administration" subtitle="Settings and diagnostics are for the administrator." />
      <Card className="max-w-lg space-y-4">
        {loading ? (
          <p className="text-sm text-muted">Checking…</p>
        ) : !required ? (
          <p className="text-sm text-muted">
            No admin key is set on this server, so admin mode is open to everyone (fine for local use). For production, set
            <code className="mx-1 rounded bg-surface-2 px-1">ADMIN_KEY</code> in the backend environment.
          </p>
        ) : admin ? (
          <>
            <p className="text-sm">✓ Admin mode is on in this browser: Settings and the diagnostic screens are visible.</p>
            <button type="button" className={btnSecondary} onClick={() => void leave()}>
              Leave admin mode
            </button>
          </>
        ) : (
          <form onSubmit={unlock} className="space-y-3">
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium">Admin key</span>
              <input
                type="password"
                autoComplete="current-password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface px-3 py-2 outline-none focus:border-accent"
              />
            </label>
            {error && <ErrorBanner message={error} />}
            <button type="submit" className={btnPrimary} disabled={busy}>
              {busy ? "Checking…" : "Unlock admin mode"}
            </button>
          </form>
        )}
      </Card>
      {admin && (
        <div className="mt-6">
          <RetentionSettings />
          <div className="mt-6">
            <PricingSettings />
          </div>
        </div>
      )}
    </>
  );
}
