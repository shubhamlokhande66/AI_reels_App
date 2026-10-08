"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { useCredits, useMe } from "@/hooks/useApi";
import { btnDanger, btnPrimary, btnSecondary, Card, ErrorBanner, PageHeader, Spinner } from "@/components/ui";
import { LegalFooter } from "@/components/Legal";

const FIELD = "w-full rounded-xl border border-border bg-surface px-3 py-2 outline-none focus:border-accent";

function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!current) return setMsg({ ok: false, text: "Enter your current password." });
    if (next.length < 8) return setMsg({ ok: false, text: "Use a new password of at least 8 characters." });
    if (next === current) return setMsg({ ok: false, text: "The new password is the same as the current one." });
    setBusy(true);
    try {
      await api.changePassword(current, next);
      setCurrent("");
      setNext("");
      setMsg({ ok: true, text: "Password changed. You were signed out on your other devices." });
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4">
      <h2 className="font-medium">Change password</h2>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-muted">Current password</span>
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={FIELD} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-muted">New password (8+ characters)</span>
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={FIELD} />
        </label>
        <div className="sm:col-span-2">
          {msg && <p className={`mb-3 text-sm ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>}
          <button type="submit" className={btnPrimary} disabled={busy}>
            {busy ? "Saving…" : "Change password"}
          </button>
        </div>
      </form>
    </Card>
  );
}

function DeleteAccount({ email }: { email: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (confirm.trim().toLowerCase() !== email) return setError("Type your email address exactly to confirm.");
    if (!password) return setError("Enter your password.");
    setBusy(true);
    try {
      await api.deleteAccount(password, confirm.trim());
      qc.clear();
      router.replace("/login");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3 border-danger/40">
      <h2 className="font-medium text-danger">Delete account</h2>
      <p className="text-sm text-muted">
        Deletes your account, all your projects, uploads, Reels, brands, songs and credits, for good. It cannot be undone. Download
        anything you want to keep first. Payment records are kept for tax purposes, without your name.
      </p>
      {!open ? (
        <button type="button" className={btnDanger} onClick={() => setOpen(true)}>
          Delete my account…
        </button>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-muted">
              Type <strong className="text-foreground">{email}</strong> to confirm
            </span>
            <input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" className={FIELD} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-muted">Your password</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={FIELD} />
          </label>
          {error && <ErrorBanner message={error} />}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={btnDanger} disabled={busy}>
              {busy ? "Deleting…" : "Delete everything"}
            </button>
            <button type="button" className={btnSecondary} disabled={busy} onClick={() => setOpen(false)}>
              Keep my account
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}

/** The signed-in person's account: email, plan and credits, password, sign out everywhere, delete. */
export default function AccountPage() {
  const me = useMe();
  const credits = useCredits();
  const qc = useQueryClient();
  const [everywhere, setEverywhere] = useState<string | null>(null);

  if (me.isLoading) return <Spinner label="Loading your account…" />;
  if (!me.data?.authEnabled)
    return (
      <>
        <PageHeader title="Account" />
        <Card>
          <p className="text-sm text-muted">This studio runs without accounts (a single-person install), so there is nothing to manage here.</p>
        </Card>
      </>
    );
  const user = me.data.user;
  if (!user) return <Spinner label="Signing in…" />;
  const c = credits.data?.enabled ? credits.data : null;

  return (
    <>
      <PageHeader title="Account" subtitle={user.email} />
      <div className="max-w-2xl space-y-6">
        <Card className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted">Plan</p>
            <p className="font-display text-2xl">{c ? c.planName : "Free"}</p>
            {c && <p className="text-sm text-muted">{c.balance} credits</p>}
          </div>
          <Link href="/pricing" className={btnSecondary}>
            Plans & credits
          </Link>
        </Card>
        <ChangePassword />
        <Card className="space-y-3">
          <h2 className="font-medium">Signed in somewhere else?</h2>
          <p className="text-sm text-muted">Sign out on every other phone and computer. This one stays signed in.</p>
          {everywhere && <p className="text-sm text-success">{everywhere}</p>}
          <button
            type="button"
            className={btnSecondary}
            onClick={async () => {
              try {
                await api.logoutEverywhere();
                await qc.invalidateQueries({ queryKey: ["me"] });
                setEverywhere("Done: every other session has ended.");
              } catch (e) {
                setEverywhere(errorMessage(e));
              }
            }}
          >
            Sign out everywhere else
          </button>
        </Card>
        <DeleteAccount email={user.email} />
      </div>
      <LegalFooter className="mt-12" />
    </>
  );
}
