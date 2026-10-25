"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Logo } from "@/components/atoms";
import { ErrorBanner } from "@/components/molecules";
import { useMe } from "@/hooks/useApi";
import { api, errorMessage } from "@/lib/api";
import { setAdminKey } from "@/lib/admin";

/** The administrator's sign-in (the admin dashboard and the CMS): who is signed in, and the admin password. */
export function AdminSignIn() {
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
      <section className="flex min-w-0 flex-col gap-2.5 rounded-2xl border border-border bg-surface p-3.5 shadow-[var(--shadow)] w-full max-w-sm" style={{ gap: 12 }} aria-label="Admin sign-in">
        <Logo height={72} className="mx-auto" />
        <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">Administration</span>
        <span className="m-0 text-[15px] font-bold">This part is for the administrator</span>
        <span className="text-muted text-[12.5px]">
          {email ? `${email} is not an administrator account.` : "Sign in with an administrator account."} An administrator can also unlock this browser with the admin password.
        </span>
        <form onSubmit={unlock} className="flex flex-col gap-3">
          <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-bold text-muted">
            Admin password
            <input type="password" autoComplete="current-password" placeholder="••••••••" value={key} onChange={(e) => setKey(e.target.value)} className="w-full min-w-0 rounded-xl border border-border bg-surface px-3 text-[14px] font-medium text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_22%,transparent)] disabled:opacity-60 h-11" />
          </label>
          {error && <ErrorBanner message={error} />}
          <button type="submit" className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-bold transition-[filter,border-color,background-color,color] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent border border-transparent bg-[image:var(--gold-gradient)] text-[var(--on-accent)] shadow-[0_12px_26px_-14px_var(--brand-glow)] hover:brightness-110 h-11 rounded-xl px-4 text-sm" disabled={busy}>
            {busy ? "Checking…" : "Unlock admin"}
          </button>
        </form>
        <Link href="/" className="text-accent text-[12.5px] text-center font-bold">
          Back to the studio
        </Link>
      </section>
    </div>
  );
}
