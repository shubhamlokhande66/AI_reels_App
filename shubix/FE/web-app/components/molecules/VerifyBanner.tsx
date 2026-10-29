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
    <div role="status" className="relative mb-4 flex flex-wrap items-center gap-3 overflow-hidden rounded-[18px] border border-[color-mix(in_srgb,var(--warning)_28%,var(--line))] bg-[linear-gradient(105deg,color-mix(in_srgb,var(--warning)_10%,var(--surface)),var(--surface)_72%)] px-3.5 py-3 shadow-[0_14px_34px_-28px_rgba(0,0,0,.7)] sm:px-4">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-warning/20 bg-warning/10 text-warning"><Icon name="mail" size={17} /></span>
      <p className="m-0 min-w-0 flex-1 text-[12.5px] leading-relaxed">{state.text ? <span className={state.ok ? "text-success" : "text-danger"}>{state.text}</span> : t("auth.verifyBannerCode", { email })}</p>
      <Button size="sm" href="/verify">{t("auth.enterCode")}</Button>
      {!state.ok && <Button size="sm" variant="secondary" loading={state.busy} onClick={resend}>{t("auth.resendCode")}</Button>}
    </div>
  );
}
