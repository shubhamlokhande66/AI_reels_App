"use client";

import { useState } from "react";
import Link from "next/link";
import { api, errorMessage } from "@/lib/api";
import { btnPrimary, ErrorBanner } from "@/components/ui";

const FIELD = "w-full rounded-xl border border-border bg-surface px-3 py-2.5 outline-none focus:border-accent";

/** Ask for a password reset link by email. */
export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setError("Enter a valid email address.");
    setBusy(true);
    try {
      await api.forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <div className="lux-card lux-enter w-full max-w-md rounded-3xl p-8">
        <p className="lux-eyebrow">Reel Maison</p>
        <h1 className="mt-1 font-display text-4xl">Forgot your password?</h1>
        {sent ? (
          <p className="mt-4 rounded-2xl border border-success/40 bg-success/10 p-4 text-sm">
            If an account exists for <strong>{email.trim()}</strong>, we sent it a link to choose a new password. It works for one hour.
            Check your spam folder too.
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted">Enter your account&apos;s email and we will send you a link to choose a new password.</p>
            <form onSubmit={submit} className="mt-6 space-y-4">
              <label className="block text-sm">
                <span className="mb-1.5 block font-medium">Email</span>
                <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={FIELD} />
              </label>
              {error && <ErrorBanner message={error} />}
              <button type="submit" className={`${btnPrimary} w-full py-3`} disabled={busy}>
                {busy ? "Sending…" : "Send the link"}
              </button>
            </form>
          </>
        )}
        <p className="mt-5 text-center text-sm text-muted">
          <Link href="/login" className="text-accent hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
