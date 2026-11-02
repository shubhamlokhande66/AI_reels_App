"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Icon, Logo, Spinner } from "@/components/atoms";
import { ErrorBanner } from "@/components/molecules";
import { OtpInput } from "@/components/molecules/OtpInput";
import { useAdmin, useMe } from "@/hooks/useApi";
import { api, errorMessage } from "@/lib/api";
import { useCountdown } from "@/lib/useCountdown";
import { maskEmail } from "@/lib/validate";
import { AdminSignIn } from "./AdminSignIn";

/** A page only the administrator opens (the admin dashboard, the CMS): an admin account whose daily code is due enters
 * it first; anyone else gets the admin sign-in. */
export function AdminGate({ children }: { children: React.ReactNode }) {
  const { admin, otp, loading } = useAdmin();
  if (loading) return <div className="grid min-h-screen place-items-center"><Spinner label="Checking…" /></div>;
  if (admin) return <>{children}</>;
  return otp ? <Suspense fallback={null}><AdminCode /></Suspense> : <AdminSignIn />;
}

/** The admin code, once a day for security: emailed at sign-in (?code=sent), else at once when this opens (a code sent a
 * moment ago counts as sent). `onLater`: the studio's own pages may go on without the admin powers for now. */
export function AdminCode({ onLater }: { onLater?: () => void }) {
  const qc = useQueryClient(), me = useMe(), params = useSearchParams();
  const justSent = params.get("code") === "sent";
  const [sent, setSent] = useState(justSent), [code, setCode] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const wait = useCountdown(justSent ? 60 : 0);
  const email = me.data?.user?.email ?? "";
  const send = async (first = false) => {
    setError(null); setBusy(true);
    try { const r = await api.adminCode(); wait.start(r.wait ?? 60); setSent(true); }
    catch (e) { if (first && (e as { code?: string }).code === "VERIFY_TOO_SOON") { setSent(true); wait.start(60); } else setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (!justSent) void send(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const verify = async (c = code) => {
    if (c.length !== 6 || busy) return;
    setBusy(true); setError(null);
    try { await api.adminVerify(c); await qc.invalidateQueries(); } catch (e) { setError(errorMessage(e)); setCode(""); } finally { setBusy(false); }
  };
  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <section className="flex w-full max-w-sm flex-col gap-3 rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow)]" aria-label="Admin code">
        <Logo height={64} className="mx-auto" />
        <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-muted"><Icon name="shield" size={14} />Admin security</span>
        <span className="text-[15px] font-bold">Confirm it&apos;s you</span>
        <span className="text-[12.5px] text-muted">
          {sent ? `We sent a 6-digit code to ${maskEmail(email)}. Enter it to open the administration for the next 24 hours.`
            : "For security, the administration asks for a code from your email once a day."}
        </span>
        {sent ? (
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void verify(); }}>
            <OtpInput label="Admin code" value={code} onChange={(v) => { setCode(v); setError(null); }} onComplete={(v) => void verify(v)} invalid={!!error} disabled={busy} />
            {error && <ErrorBanner message={error} />}
            <Button type="submit" loading={busy} disabled={code.length !== 6}>Open the administration</Button>
            <p className="m-0 text-center text-[12.5px] text-muted">
              Didn&apos;t get it?{" "}
              {wait.left > 0 ? <span>Send again in {wait.left}s</span> : <button type="button" className="font-bold text-accent" onClick={() => void send()}>Send a new code</button>}
            </p>
          </form>
        ) : (
          <>
            {error && <ErrorBanner message={error} />}
            <Button icon="mail" loading={busy} onClick={() => void send()}>Email me a code</Button>
          </>
        )}
        {onLater
          ? <button type="button" className="text-center text-[12.5px] text-muted" onClick={onLater}>Continue without admin powers</button>
          : <Link href="/" className="text-center text-[12.5px] font-bold text-accent">Back to the studio</Link>}
      </section>
    </div>
  );
}
