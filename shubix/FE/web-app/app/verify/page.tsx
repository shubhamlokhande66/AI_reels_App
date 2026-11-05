"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { useMe, useText } from "@/hooks/useApi";
import { useCountdown } from "@/lib/useCountdown";
import { maskEmail } from "@/lib/validate";
import { Button, Card, Icon, Spinner } from "@/components/atoms";
import { AuthFrame } from "@/components/molecules/AuthFrame";
import { ErrorBanner } from "@/components/molecules";
import { OtpInput } from "@/components/molecules/OtpInput";

const Done = ({ email }: { email: string }) => {
  const text = useText();
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-success/15 text-success"><Icon name="check" size={28} /></span>
      <h2 className="m-0 text-[17px] font-semibold">{text("auth.verifiedTitle")}</h2>
      <p className="m-0 text-[13px] text-muted">{text("auth.verifiedText", { email })}</p>
      <Button href="/" full>{text("auth.continue")}</Button>
    </div>
  );
};

/** A "Verify my email" link emailed before the codes. */
function ByLink({ token }: { token: string }) {
  const qc = useQueryClient(), text = useText();
  const [state, setState] = useState<{ email?: string; error?: string }>({});
  const once = useRef(false); // the link works once: do not send it twice (React's dev double effect)
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    api.verifyEmail(token)
      .then((r) => { setState({ email: r.email }); void qc.invalidateQueries({ queryKey: ["me"] }); })
      .catch((e) => setState({ error: errorMessage(e) }));
  }, [token, qc]);
  if (state.error) return <><ErrorBanner message={state.error} /><Button href="/verify">{text("auth.enterCode")}</Button></>;
  if (!state.email) return <Spinner label={text("auth.verifying")} />;
  return <Done email={state.email} />;
}

/** The 6-digit code from the sign-up email (the person is signed in). */
function ByCode({ justSent }: { justSent: boolean }) {
  const qc = useQueryClient(), text = useText(), me = useMe(), router = useRouter();
  const [code, setCode] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null), [note, setNote] = useState<string | null>(null);
  const wait = useCountdown(justSent ? 60 : 0);
  const user = me.data?.user, codeWait = user?.codeWait, startWait = wait.start;
  useEffect(() => { if (codeWait) startWait(codeWait); }, [codeWait]); // eslint-disable-line react-hooks/exhaustive-deps -- how long the server still wants, on any way here
  if (me.isLoading) return <Spinner />;
  if (!user) return <p className="m-0 text-[13px]">{text("auth.signInToVerify")} <Link href="/login" className="font-bold text-accent">{text("auth.signIn")}</Link></p>;
  if (done || user.emailVerified !== false) return <Done email={done ?? user.email} />;

  const verify = async (c = code) => {
    if (c.length !== 6 || busy) return;
    setBusy(true); setError(null);
    try { const r = await api.verifyCode(c); setDone(r.email); void qc.invalidateQueries({ queryKey: ["me"] }); }
    catch (e) { setError(errorMessage(e)); setCode(""); }
    finally { setBusy(false); }
  };
  const resend = async () => {
    setError(null); setNote(null);
    try { const r = await api.resendVerify(); wait.start(r.wait ?? 60); if (r.sent === false) setError(text("auth.codeNotSent")); else setNote(text("auth.codeResent")); }
    catch (e) { const w = (e as { details?: { wait?: unknown } }).details?.wait; if (typeof w === "number") wait.start(w); else setError(errorMessage(e)); }
  };
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void verify(); }}><fieldset disabled={busy} className="contents">
      <p className="m-0 text-[13px] text-muted">{text("auth.codeSentTo", { email: maskEmail(user.email) })}</p>
      <OtpInput label={text("auth.codeLabel")} value={code} onChange={(v) => { setCode(v); setError(null); }} onComplete={(v) => void verify(v)} invalid={!!error} disabled={busy} />
      {error && <ErrorBanner message={error} />}
      {note && !error && <p className="m-0 text-[12.5px] font-semibold text-success">{note}</p>}
      <Button type="submit" loading={busy} disabled={code.length !== 6}>{text("auth.verifyButton")}</Button>
      <p className="m-0 text-center text-[12.5px] text-muted">
        {text("auth.noCode")}{" "}
        {wait.left > 0 ? <span>{text("auth.resendIn", { s: wait.left })}</span>
          : <button type="button" className="font-bold text-accent" onClick={() => void resend()}>{text("auth.resendCode")}</button>}
      </p>
      <p className="m-0 text-center text-[11.5px] text-muted">{text("auth.checkSpam")}</p>
      <button type="button" className="text-center text-[12.5px] font-bold text-accent" onClick={() => void api.logout().then(() => qc.invalidateQueries()).then(() => router.replace("/login"))}>{text("auth.useOtherEmail")}</button>
    </fieldset></form>
  );
}

function Verify() {
  const q = useSearchParams(), token = q.get("token") ?? "";
  return token ? <ByLink token={token} /> : <ByCode justSent={q.get("sent") === "1"} />;
}

/** Verify the email: the 6-digit code from the sign-up email (or a link emailed before the codes). */
export default function VerifyPage() {
  const text = useText();
  return (
    <AuthFrame>
      <Card className="flex flex-col gap-3">
        <h1 className="m-0 font-[family-name:var(--font-display)] text-[21px] font-semibold tracking-[-0.015em]">{text("auth.verifyTitle")}</h1>
        <Suspense fallback={null}><Verify /></Suspense>
      </Card>
    </AuthFrame>
  );
}
