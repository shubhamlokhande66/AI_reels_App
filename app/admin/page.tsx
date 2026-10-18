"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Logo, Spinner } from "@/components/atoms";
import { ErrorBanner } from "@/components/molecules";
import { AdminDashboard } from "@/components/organisms/admin/AdminDashboard";
import { useAdmin, useMe } from "@/hooks/useApi";
import { api, errorMessage } from "@/lib/api";
import { setAdminKey } from "@/lib/admin";

/** The admin dashboard for an administrator (an ADMIN_EMAILS account, or this browser unlocked with the ADMIN_KEY);
 * anyone else sees that it is for the administrator, with the key sign-in. */
export default function AdminPage() {
  const { admin, loading } = useAdmin();
  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner label="Checking…" />
      </div>
    );
  }
  return admin ? <AdminDashboard /> : <AdminSignIn />;
}

function AdminSignIn() {
  const qc = useQueryClient();
  const me = useMe();
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

  const email = me.data?.user?.email;
  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <section className="card w-full max-w-sm" style={{ gap: 12 }} aria-label="Admin sign-in">
        <Logo height={40} />
        <span className="eb">Administration</span>
        <span className="h2">This part is for the administrator</span>
        <span className="mu sm">
          {email ? `${email} is not an administrator account.` : "Sign in with an administrator account."} An administrator can also unlock this browser with the admin password.
        </span>
        <form onSubmit={unlock} className="flex flex-col gap-3">
          <label className="f">
            Admin password
            <input type="password" autoComplete="current-password" placeholder="••••••••" value={key} onChange={(e) => setKey(e.target.value)} className="inp" />
          </label>
          {error && <ErrorBanner message={error} />}
          <button type="submit" className="btn g" disabled={busy}>
            {busy ? "Checking…" : "Unlock admin"}
          </button>
        </form>
        <Link href="/" className="ac sm text-center font-bold">
          Back to the studio
        </Link>
      </section>
    </div>
  );
}
