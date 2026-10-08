"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { btnPrimary, ErrorBanner } from "@/components/ui";

const FIELD = "w-full rounded-xl border border-border bg-surface px-3 py-2.5 outline-none focus:border-accent";

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
    if (password !== again) return setError("The two passwords are not the same.");
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
      <p className="mt-4 text-sm">
        This link is incomplete. <Link href="/forgot" className="text-accent hover:underline">Ask for a new one</Link>.
      </p>
    );
  return (
    <form onSubmit={submit} className="mt-6 space-y-4">
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">New password</span>
        <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={FIELD} />
        <span className="mt-1 block text-xs text-muted">At least 8 characters.</span>
      </label>
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Type it again</span>
        <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className={FIELD} />
      </label>
      {error && <ErrorBanner message={error} />}
      {error?.includes("expired") && (
        <p className="text-sm">
          <Link href="/forgot" className="text-accent hover:underline">Ask for a new link</Link>
        </p>
      )}
      <button type="submit" className={`${btnPrimary} w-full py-3`} disabled={busy}>
        {busy ? "Saving…" : "Save the new password"}
      </button>
    </form>
  );
}

/** Choose a new password from the emailed link. Every other session ends; this device is signed in. */
export default function ResetPage() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <div className="lux-card lux-enter w-full max-w-md rounded-3xl p-8">
        <p className="lux-eyebrow">Reel Maison</p>
        <h1 className="mt-1 font-display text-4xl">Choose a new password</h1>
        <Suspense fallback={null}>
          <ResetForm />
        </Suspense>
      </div>
    </div>
  );
}
