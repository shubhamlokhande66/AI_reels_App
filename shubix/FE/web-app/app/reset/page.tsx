"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { useText } from "@/hooks/useApi";
import { Button, Card } from "@/components/atoms";
import { passwordOk } from "@/lib/validate";
import { AuthFrame } from "@/components/molecules/AuthFrame";
import { ErrorBanner, Field, PasswordInput } from "@/components/molecules";

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();
  const qc = useQueryClient();
  const text = useText();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!passwordOk(password)) return setError(text("auth.shortPassword"));
    if (password !== again) return setError(text("auth.mismatch"));
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
      <p className="m-0 text-[12.5px]">
        {text("auth.badLink")} <Link href="/forgot" className="font-bold text-accent">{text("auth.askNew")}</Link>.
      </p>
    );
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field label={text("auth.newPassword")} hint={text("auth.lengthHint")} error={password && !passwordOk(password) ? text("auth.shortPassword") : ""} ok={passwordOk(password) ? text("auth.strongEnough") : ""}>
        <PasswordInput autoComplete="new-password" placeholder={text("auth.newPasswordPlaceholder")} value={password} invalid={!!password && !passwordOk(password)} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label={text("auth.confirmPassword")} error={again && again !== password ? text("auth.mismatch") : ""} ok={again && again === password ? text("auth.match") : ""}>
        <PasswordInput autoComplete="new-password" placeholder={text("auth.confirmPlaceholder")} value={again} invalid={!!again && again !== password} onChange={(e) => setAgain(e.target.value)} />
      </Field>
      {error && <ErrorBanner message={error} />}
      {error?.includes("expired") && (
        <Link href="/forgot" className="text-[12.5px] font-bold text-accent">
          {text("auth.askNewLink")}
        </Link>
      )}
      <Button type="submit" loading={busy} disabled={!passwordOk(password) || again !== password}>{busy ? text("auth.saving") : text("auth.resetButton")}</Button>
    </form>
  );
}

/** Choose a new password from the emailed link. Every other session ends; this device is signed in. */
export default function ResetPage() {
  const text = useText();
  return (
    <AuthFrame>
      <Card className="flex flex-col gap-3">
        <h1 className="m-0 font-[family-name:var(--font-display)] text-[21px] font-semibold tracking-[-0.015em]">{text("auth.resetTitle")}</h1>
        <Suspense fallback={null}>
          <ResetForm />
        </Suspense>
      </Card>
    </AuthFrame>
  );
}
