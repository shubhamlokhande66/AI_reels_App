"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { btnPrimary, ErrorBanner } from "@/components/ui";

const FIELD = "w-full rounded-xl border border-border bg-surface px-3 py-2.5 outline-none focus:border-accent";

/** Sign in, or create an account (accounts on: AUTH_ENABLED on the server). */
export default function LoginPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setError("Enter a valid email address.");
    if (mode === "signup" && password.length < 8) return setError("Use a password of at least 8 characters.");
    if (!password) return setError("Enter your password.");
    setBusy(true);
    try {
      await (mode === "signin" ? api.login(email.trim(), password) : api.register(email.trim(), password));
      await qc.invalidateQueries();
      router.replace("/");
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
        <h1 className="mt-1 font-display text-4xl">{mode === "signin" ? "Welcome back" : "Create your studio"}</h1>
        <p className="mt-2 text-sm text-muted">
          {mode === "signin" ? "Sign in to your AI Reel studio." : "Your projects, brands and songs stay private to your account."}
        </p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">Email</span>
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={FIELD} />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">Password</span>
            <input
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={FIELD}
            />
            {mode === "signup" && <span className="mt-1 block text-xs text-muted">At least 8 characters.</span>}
          </label>
          {error && <ErrorBanner message={error} />}
          <button type="submit" className={`${btnPrimary} w-full py-3`} disabled={busy}>
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>
        <p className="mt-5 text-center text-sm text-muted">
          {mode === "signin" ? "New here?" : "Already have an account?"}{" "}
          <button type="button" className="text-accent hover:underline" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); }}>
            {mode === "signin" ? "Create an account" : "Sign in"}
          </button>
        </p>
        <p className="mt-3 text-center text-xs text-muted">
          <a href="/pricing" className="hover:text-accent">See plans & pricing</a>
        </p>
      </div>
    </div>
  );
}
