"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { emailOk, maskEmail, passwordOk } from "@/lib/validate";
import { useCountdown } from "@/lib/useCountdown";
import { useT } from "@/hooks/useApi";
import { Button, Card, Input } from "@/components/atoms";
import { AuthFrame } from "@/components/molecules/AuthFrame";
import { ErrorBanner, Field, PasswordInput } from "@/components/molecules";
import { OtpInput } from "@/components/molecules/OtpInput";

/** Forgot the password: the email, then the 6-digit code from the email and a new password. Every other session ends;
 * this device is signed in. */
export default function ForgotPage() {
  const t = useT(), router = useRouter(), qc = useQueryClient();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState(""), [touched, setTouched] = useState(false);
  const [code, setCode] = useState(""), [password, setPassword] = useState(""), [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null), [note, setNote] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const wait = useCountdown();
  const pwBox = useRef<HTMLDivElement>(null);
  // the 6th digit: go on by itself (the passwords already typed: reset now; else on to the new password)
  const codeDone = (c: string) => {
    if (passwordOk(password) && password === again) void submit(c);
    else pwBox.current?.querySelector("input")?.focus();
  };

  const send = async () => {
    setError(null); setNote(null);
    if (!emailOk(email)) return setError(t("auth.badEmail"));
    setBusy(true);
    try {
      const r = await api.forgotPassword(email.trim());
      wait.start(r.wait ?? 60);
      if (step === "code") setNote(t("auth.codeResent"));
      setStep("code");
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };
  const reset = (e: React.FormEvent) => { e.preventDefault(); void submit(code); };
  const submit = async (code: string) => {
    if (busy) return;
    setError(null); setNote(null);
    if (code.length !== 6) return setError(t("auth.enterSixDigits"));
    if (!passwordOk(password)) return setError(t("auth.shortPassword"));
    if (password !== again) return setError(t("auth.mismatch"));
    setBusy(true);
    try {
      await api.resetWithCode(email.trim(), code, password);
      await qc.invalidateQueries();
      router.replace("/");
    } catch (err) { setError(errorMessage(err)); setCode(""); } finally { setBusy(false); }
  };

  return (
    <AuthFrame>
      <Card className="flex flex-col gap-3">
        <h1 className="m-0 font-[family-name:var(--font-display)] text-[21px] font-semibold tracking-[-0.015em]">{step === "email" ? t("auth.forgotTitle") : t("auth.resetTitle")}</h1>
        {step === "email" ? (
          <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="flex flex-col gap-3">
            <p className="m-0 text-[12.5px] text-muted">{t("auth.forgotCodeText")}</p>
            <Field label={t("auth.email")} error={touched && email && !emailOk(email) ? t("auth.badEmail") : ""}>
              <Input type="email" autoComplete="email" placeholder={t("auth.emailPlaceholder")} value={email} className={touched && email && !emailOk(email) ? "border-danger" : undefined}
                onChange={(e) => setEmail(e.target.value)} onBlur={() => setTouched(true)} />
            </Field>
            {error && <ErrorBanner message={error} />}
            <Button type="submit" loading={busy} disabled={!emailOk(email)}>{busy ? t("auth.sending") : t("auth.sendCode")}</Button>
          </form>
        ) : (
          <form onSubmit={reset} className="flex flex-col gap-3">
            <p className="m-0 text-[12.5px] text-muted">{t("auth.resetCodeSent", { email: maskEmail(email.trim()) })}</p>
            <OtpInput label={t("auth.codeLabel")} value={code} onChange={(v) => { setCode(v); setError(null); }} onComplete={codeDone} invalid={!!error && code.length === 0} disabled={busy} />
            <div ref={pwBox} className="contents">
            <Field label={t("auth.newPassword")} hint={t("auth.lengthHint")} error={password && !passwordOk(password) ? t("auth.shortPassword") : ""} ok={passwordOk(password) ? t("auth.strongEnough") : ""}>
              <PasswordInput autoComplete="new-password" placeholder={t("auth.newPasswordPlaceholder")} value={password} invalid={!!password && !passwordOk(password)} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field label={t("auth.confirmPassword")} error={again && again !== password ? t("auth.mismatch") : ""} ok={again && again === password ? t("auth.match") : ""}>
              <PasswordInput autoComplete="new-password" placeholder={t("auth.confirmPlaceholder")} value={again} invalid={!!again && again !== password}
                onChange={(e) => { setAgain(e.target.value); if (code.length === 6 && passwordOk(password) && e.target.value === password) void submit(code); }} />
            </Field>
            </div>
            {error && <ErrorBanner message={error} />}
            {note && !error && <p className="m-0 text-[12.5px] font-semibold text-success">{note}</p>}
            <Button type="submit" loading={busy} disabled={code.length !== 6 || !passwordOk(password) || again !== password}>{busy ? t("auth.saving") : t("auth.resetButton")}</Button>
            <p className="m-0 text-center text-[12.5px] text-muted">
              {t("auth.noCode")}{" "}
              {wait.left > 0 ? <span>{t("auth.resendIn", { s: wait.left })}</span>
                : <button type="button" className="font-bold text-accent" onClick={() => void send()}>{t("auth.resendCode")}</button>}
              {" · "}
              <button type="button" className="font-bold text-accent" onClick={() => { setStep("email"); setCode(""); setError(null); setNote(null); }}>{t("auth.otherEmail")}</button>
            </p>
            <p className="m-0 text-center text-[11.5px] text-muted">{t("auth.checkSpam")}</p>
          </form>
        )}
      </Card>
    </AuthFrame>
  );
}
