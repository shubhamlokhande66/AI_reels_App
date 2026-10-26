"use client";

import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { useT } from "@/hooks/useApi";
import { Button, Icon } from "@/components/atoms";

/** "Verify your email" over every page until the code from the sign-up email is entered: Enter code, or Resend. */
export function VerifyBanner({ email }: { email: string }) {
  const t = useT();
  const [state, setState] = useState<{ busy?: boolean; text?: string; ok?: boolean }>({});
  const resend = async () => {
    setState({ busy: true });
    try {
      await api.resendVerify();
      setState({ ok: true, text: t("auth.codeResent") });
    } catch (e) {
      setState({ ok: false, text: errorMessage(e) });
    }
  };
  return (
    <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-[13px]">
      <Icon name="mail" size={18} className="shrink-0 text-warning" />
      <p className="m-0 min-w-0 flex-1">{state.text ? <span className={state.ok ? "text-success" : "text-danger"}>{state.text}</span> : t("auth.verifyBannerCode", { email })}</p>
      <Button size="sm" href="/verify">{t("auth.enterCode")}</Button>
      {!state.ok && <Button size="sm" variant="secondary" loading={state.busy} onClick={resend}>{t("auth.resendCode")}</Button>}
    </div>
  );
}
