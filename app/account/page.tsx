"use client";

import { useState } from "react";
import { ThemeChoice } from "@/components/molecules/ThemeToggle";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { useCredits, useMe } from "@/hooks/useApi";
import { Spinner } from "@/components/atoms";
import { ErrorBanner, PageHeader } from "@/components/molecules";


function ChangePassword({ email }: { email: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!current) return setMsg({ ok: false, text: "Enter your current password." });
    if (next.length < 8) return setMsg({ ok: false, text: "Your new password needs at least 8 characters." });
    if (next !== again) return setMsg({ ok: false, text: "The two new passwords don't match." });
    if (next === current) return setMsg({ ok: false, text: "The new password is the same as your current one." });
    setBusy(true);
    try {
      await api.changePassword(current, next);
      setCurrent("");
      setNext("");
      setAgain("");
      setMsg({ ok: true, text: "Password updated. You've been signed out on your other devices." });
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card" aria-label="Change password">
      <span className="h2">Change password</span>
      <label className="f">
        Email
        <input className="inp" value={email} disabled readOnly />
      </label>
      <label className="f">
        Current password
        <input type="password" autoComplete="current-password" placeholder="••••••••" value={current} onChange={(e) => setCurrent(e.target.value)} className="inp" />
      </label>
      <label className="f">
        New password
        <input type="password" autoComplete="new-password" placeholder="At least 8 characters" value={next} onChange={(e) => setNext(e.target.value)} className="inp" />
      </label>
      <label className="f">
        Confirm new password
        <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className="inp" />
      </label>
      {msg && <p className={`sm ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>}
      <button type="submit" className="btn g" disabled={busy}>
        {busy ? "Saving…" : "Update password"}
      </button>
    </form>
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
    <section className="card" style={{ borderColor: "color-mix(in srgb, var(--danger) 30%, var(--border))" }} aria-label="Delete account">
      <span className="h2 text-danger">Delete account</span>
      <span className="mu sm">Removes your projects, clips and songs. This cannot be undone. Download anything you want to keep first.</span>
      {!open ? (
        <button type="button" className="btn danger" onClick={() => setOpen(true)}>
          Delete my account
        </button>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-2.5">
          <label className="f">
            <span>
              Type <strong className="text-foreground">{email}</strong> to confirm
            </span>
            <input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" className="inp" />
          </label>
          <label className="f">
            Your password
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="inp" />
          </label>
          {error && <ErrorBanner message={error} />}
          <div className="g2">
            <button type="button" className="btn" disabled={busy} onClick={() => setOpen(false)}>
              Keep my account
            </button>
            <button type="submit" className="btn danger fill" disabled={busy}>
              {busy ? "Deleting…" : "Delete everything"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/** The signed-in person's account: email, plan and credits, password, sign out everywhere, delete. */
export default function AccountPage() {
  const me = useMe();
  const credits = useCredits();
  const qc = useQueryClient();
  const [everywhere, setEverywhere] = useState<string | null>(null);
  const [tab, setTab] = useState<"password" | "sessions" | "delete">("password");

  if (me.isLoading) return <Spinner label="Loading your account…" />;
  if (!me.data?.authEnabled)
    return (
      <div className="mx-auto w-full max-w-xl">
        <PageHeader title="My account" />
        <p className="card mu sm">This studio runs without accounts, so there is nothing to manage here.</p>
        <ThemeChoice />
      </div>
    );
  const user = me.data.user;
  if (!user) return <Spinner label="Signing in…" />;
  const c = credits.data?.enabled ? credits.data : null;
  const name = user.email.split("@")[0];

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-3">
      <PageHeader title="My account" />
      <div className="row">
        <span className="avatar h-[52px] w-[52px] font-display text-[22px] font-semibold">{name[0]?.toUpperCase()}</span>
        <span className="flex min-w-0 flex-col">
          <b className="truncate capitalize">{name}</b>
          <span className="mu sm truncate">
            {user.email} · {c ? `${c.planName} plan` : "Free"}
          </span>
        </span>
        {c && (
          <Link href="/pricing" className="cred ml-auto">
            <i aria-hidden />
            {c.balance.toLocaleString("en-IN")}
            <span className="sr-only"> credits</span>
          </Link>
        )}
      </div>
      <div className="tabs2" role="tablist" aria-label="Account sections">
        {(
          [
            ["password", "Password"],
            ["sessions", "Sessions"],
            ["delete", "Delete"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      {tab === "password" && <ChangePassword email={user.email} />}
      {tab === "sessions" && (
        <section className="card" aria-label="Sessions">
          <span className="h2">Signed in somewhere else?</span>
          <div className="between sm">
            <span>This device</span>
            <span className="badge b-ok">Signed in</span>
          </div>
          <span className="mu sm">Sign out on every other phone and computer. You stay signed in here.</span>
          {everywhere && <p className="sm text-success">{everywhere}</p>}
          <button
            type="button"
            className="btn"
            onClick={async () => {
              try {
                await api.logoutEverywhere();
                await qc.invalidateQueries({ queryKey: ["me"] });
                setEverywhere("Done: you're signed out everywhere else.");
              } catch (e) {
                setEverywhere(errorMessage(e));
              }
            }}
          >
            Sign out everywhere else
          </button>
        </section>
      )}
      {tab === "delete" && <DeleteAccount email={user.email} />}
      <ThemeChoice />
    </div>
  );
}
