"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { AuthFrame } from "@/components/molecules/AuthFrame";
import { ErrorBanner } from "@/components/molecules";

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();
  const qc = useQueryClient();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Use a password of at least 8 characters.");
    if (password !== again) return setError("The two passwords don't match.");
    setBusy(true);
    try {
      await api.resetPassword(token, password);
      await qc.invalidateQueries();
      router.replace("/");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!token)
    return (
      <p className="sm">
        This link is incomplete. <Link href="/forgot" className="ac font-bold">Ask for a new one</Link>.
      </p>
    );
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="f">
        New password
        <input type="password" autoComplete="new-password" placeholder="At least 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} className="inp" />
      </label>
      <label className="f">
        Confirm password
        <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className="inp" />
      </label>
      {error && <ErrorBanner message={error} />}
      {error?.includes("expired") && (
        <Link href="/forgot" className="ac sm font-bold">
          Ask for a new link
        </Link>
      )}
      <button type="submit" className="btn g" disabled={busy}>
        {busy ? "Saving…" : "Reset password"}
      </button>
    </form>
  );
}

/** Choose a new password from the emailed link. Every other session ends; this device is signed in. */
export default function ResetPage() {
  return (
    <AuthFrame>
      <div className="card" style={{ gap: 12, padding: 18 }}>
        <h1 className="ht" style={{ fontSize: 24 }}>
          Choose a new password
        </h1>
        <Suspense fallback={null}>
          <ResetForm />
        </Suspense>
      </div>
    </AuthFrame>
  );
}
