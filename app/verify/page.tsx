"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { useT } from "@/hooks/useApi";
import { Button, Card, Icon, Spinner } from "@/components/atoms";
import { AuthFrame } from "@/components/molecules/AuthFrame";
import { ErrorBanner } from "@/components/molecules";

function Verify() {
  const token = useSearchParams().get("token") ?? "";
  const qc = useQueryClient();
  const t = useT();
  const [state, setState] = useState<{ email?: string; error?: string }>({});
  const once = useRef(false); // the link works once: do not send it twice (React's dev double effect)
  useEffect(() => {
    if (!token || once.current) return;
    once.current = true;
    api.verifyEmail(token)
      .then((r) => { setState({ email: r.email }); void qc.invalidateQueries({ queryKey: ["me"] }); })
      .catch((e) => setState({ error: errorMessage(e) }));
  }, [token, qc]);

  if (!token)
    return <p className="m-0 text-[12.5px]">{t("auth.badLink")} <Link href="/account" className="font-bold text-accent">{t("auth.askNew")}</Link>.</p>;
  if (state.error) return <><ErrorBanner message={state.error} /><Button href="/">{t("auth.continue")}</Button></>;
  if (!state.email) return <Spinner label={t("auth.verifying")} />;
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-success/15 text-success"><Icon name="check" size={28} /></span>
      <h2 className="m-0 text-[17px] font-semibold">{t("auth.verifiedTitle")}</h2>
      <p className="m-0 text-[13px] text-muted">{t("auth.verifiedText", { email: state.email })}</p>
      <Button href="/" full>{t("auth.continue")}</Button>
    </div>
  );
}

/** The "Verify my email" link from the sign-up email. */
export default function VerifyPage() {
  const t = useT();
  return (
    <AuthFrame>
      <Card className="flex flex-col gap-3">
        <h1 className="m-0 font-[family-name:var(--font-display)] text-[21px] font-semibold tracking-[-0.015em]">{t("auth.verifyTitle")}</h1>
        <Suspense fallback={null}><Verify /></Suspense>
      </Card>
    </AuthFrame>
  );
}
