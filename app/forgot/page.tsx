"use client";

import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { AuthFrame } from "@/components/molecules/AuthFrame";
import { ErrorBanner } from "@/components/molecules";

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
    <AuthFrame>
      <div className="card" style={{ gap: 12, padding: 18 }}>
        <h1 className="ht" style={{ fontSize: 24 }}>
          Forgot your password?
        </h1>
        {sent ? (
          <span className="sm">
            If an account exists for <strong>{email.trim()}</strong>, we&apos;ve emailed it a link to choose a new password. The link works for one
            hour. Check your spam folder too.
          </span>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <span className="mu sm">We&apos;ll email you a link to choose a new one.</span>
            <label className="f">
              Email
              <input type="email" autoComplete="email" placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} className="inp" />
            </label>
            {error && <ErrorBanner message={error} />}
            <button type="submit" className="btn g" disabled={busy}>
              {busy ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}
      </div>
    </AuthFrame>
  );
}

