"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { StoreBadges } from "@/components/molecules/StoreBadges";
import { api, errorMessage } from "@/lib/api";
import { emailOk, passwordOk } from "@/lib/validate";
import { clearRef, savedRef } from "@/lib/marketing";
import { useT } from "@/hooks/useApi";
import { Button, Card, Input, LogoTile } from "@/components/atoms";
import { ErrorBanner, Field, PasswordInput } from "@/components/molecules";
import { LegalFooter } from "@/components/molecules/Legal";

/** Sign in, or create an account (accounts on: AUTH_ENABLED on the server). Each field says what is wrong as people
 * type (after they leave it); the button waits until the form is right. */
export default function LoginPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const t = useT();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState(""); // creating an account: the password a second time
  const [touched, setTouched] = useState<Record<string, boolean>>({}); // the fields left once: their message shows
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signin = mode === "signin";
  const touch = (k: string) => setTouched((x) => ({ ...x, [k]: true }));

  // what is wrong with each field (shown once the field was left, or the form sent)
  const emailErr = email && !emailOk(email) ? t("auth.badEmail") : "";
  const pwErr = !signin && password && !passwordOk(password) ? t("auth.shortPassword") : "";
  const againErr = !signin && again && again !== password ? t("auth.mismatch") : "";
  const valid = emailOk(email) && (signin ? !!password : passwordOk(password) && again === password);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setTouched({ email: true, password: true, again: true });
    if (!valid) return;
    setBusy(true);
    try {
      await (signin ? api.login(email.trim(), password) : api.register(email.trim(), password, savedRef()));
      if (!signin) clearRef(); // the invite is used
      await qc.invalidateQueries();
      router.replace(signin ? "/" : "/verify?sent=1"); // a new account: the code from the email first
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-[420px] flex-col justify-center gap-5 px-5 py-10">
      <div className="flex justify-center">
        <LogoTile height={72} />
      </div>
      <Card className="flex flex-col gap-[18px] p-6 md:p-7">
        <h1 className="m-0 text-center font-[family-name:var(--font-display)] text-[24px] font-semibold tracking-[-0.02em]">{t(signin ? "auth.signIn" : "auth.signUp")}</h1>
        <form onSubmit={submit} noValidate className="flex flex-col gap-[18px]">
          <Field label={t("auth.email")} error={touched.email ? emailErr : ""}>
            <Input type="email" autoComplete="email" placeholder={t("auth.emailPlaceholder")} value={email} aria-invalid={!!(touched.email && emailErr) || undefined}
              className={touched.email && emailErr ? "border-danger" : undefined} onChange={(e) => setEmail(e.target.value)} onBlur={() => touch("email")} />
          </Field>
          <Field label={t("auth.password")}
            error={touched.password ? pwErr : ""}
            ok={!signin && passwordOk(password) ? t("auth.strongEnough") : ""}
            hint={!signin ? t("auth.lengthHint") : undefined}>
            <PasswordInput autoComplete={signin ? "current-password" : "new-password"} placeholder={t(signin ? "auth.passwordPlaceholder" : "auth.newPasswordPlaceholder")}
              value={password} invalid={!!(touched.password && pwErr)} onChange={(e) => setPassword(e.target.value)} onBlur={() => touch("password")} />
          </Field>
          {!signin && (
            <Field label={t("auth.confirmPassword")} error={touched.again || (again.length >= password.length && password) ? againErr : ""} ok={again && again === password ? t("auth.match") : ""}>
              <PasswordInput autoComplete="new-password" placeholder={t("auth.confirmPlaceholder")} value={again} invalid={!!(touched.again && againErr)} onChange={(e) => setAgain(e.target.value)} onBlur={() => touch("again")} />
            </Field>
          )}
          {error && <ErrorBanner message={error} />}
          <Button type="submit" size="lg" loading={busy} disabled={!valid}>
            {busy ? t("auth.wait") : t(signin ? "auth.signIn" : "auth.signUpButton")}
          </Button>
        </form>
      </Card>
      {signin && (
        <Link href="/forgot" className="text-center text-[12.5px] font-bold text-accent">
          {t("auth.forgotLink")}
        </Link>
      )}
      <p className="m-0 text-center text-[12.5px] text-muted">
        {t(signin ? "auth.newHere" : "auth.haveAccount")}{" "}
        <button type="button" className="font-bold text-accent" onClick={() => { setMode(signin ? "signup" : "signin"); setError(null); setAgain(""); setTouched({}); }}>
          {t(signin ? "auth.createLink" : "auth.signIn")}
        </button>
      </p>
      <Link href={emailOk(email) ? `/affiliate?email=${encodeURIComponent(email.trim())}` : "/affiliate"} className="text-center text-[12.5px] font-bold text-muted hover:text-foreground">
        {t("auth.partnerLink")}
      </Link>
      <StoreBadges className="mt-3 justify-center" />
      <LegalFooter className="mt-2" />
    </div>
  );
}
