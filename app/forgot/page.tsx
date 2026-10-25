"use client";

import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { emailOk } from "@/lib/validate";
import { useT } from "@/hooks/useApi";
import { Button, Card, Input } from "@/components/atoms";
import { AuthFrame } from "@/components/molecules/AuthFrame";
import { ErrorBanner, Field } from "@/components/molecules";

/** Ask for a password reset link by email. */
export default function ForgotPage() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [touched, setTouched] = useState(false); // the email field was left once: its message shows

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!emailOk(email)) return setError(t("auth.badEmail"));
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
      <Card className="flex flex-col gap-3">
        <h1 className="m-0 font-[family-name:var(--font-display)] text-[21px] font-semibold tracking-[-0.015em]">{t("auth.forgotTitle")}</h1>
        {sent ? (
          <p className="m-0 text-[12.5px]">{t("auth.forgotSent", { email: email.trim() })}</p>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <p className="m-0 text-[12.5px] text-muted">{t("auth.forgotText")}</p>
            <Field label={t("auth.email")} error={touched && email && !emailOk(email) ? t("auth.badEmail") : ""}>
              <Input type="email" autoComplete="email" placeholder={t("auth.emailPlaceholder")} value={email} className={touched && email && !emailOk(email) ? "border-danger" : undefined}
                onChange={(e) => setEmail(e.target.value)} onBlur={() => setTouched(true)} />
            </Field>
            {error && <ErrorBanner message={error} />}
            <Button type="submit" loading={busy} disabled={!emailOk(email)}>{busy ? t("auth.sending") : t("auth.sendLink")}</Button>
          </form>
        )}
      </Card>
    </AuthFrame>
  );
}
