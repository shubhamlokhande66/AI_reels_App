"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { ErrorBanner } from "@/components/molecules";
import { LegalFooter } from "@/components/molecules/Legal";
import Link from "next/link";

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
    <div className="mx-auto flex min-h-svh w-full max-w-[400px] flex-col justify-center gap-[18px] px-7 py-10">
      <div className="brand">
        <span className="avatar mb-2.5 h-14 w-14 font-display text-[26px] font-semibold">R</span>
        <b>Shubix</b>
        <span>AI creative studio</span>
      </div>
      <h1 className="ht mt-2 text-center" style={{ fontSize: 26 }}>
        {mode === "signin" ? "Sign in" : "Create your account"}
      </h1>
      <form onSubmit={submit} className="flex flex-col gap-[18px]">
        <label className="f">
          Email
          <input type="email" autoComplete="email" placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} className="inp" />
        </label>
        <label className="f">
          Password
          <input
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            placeholder={mode === "signin" ? "Your password" : "At least 8 characters"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="inp"
          />
        </label>
        {error && <ErrorBanner message={error} />}
        <button type="submit" className="btn g big" disabled={busy}>
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>
      {mode === "signin" && (
        <Link href="/forgot" className="ac sm text-center font-bold">
          Forgot your password?
        </Link>
      )}
      <p className="mu sm text-center">
        {mode === "signin" ? "New here?" : "Already have an account?"}{" "}
        <button type="button" className="ac font-bold" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); }}>
          {mode === "signin" ? "Create an account" : "Sign in"}
        </button>
      </p>
      <LegalFooter className="mt-4" />
    </div>
  );
}
