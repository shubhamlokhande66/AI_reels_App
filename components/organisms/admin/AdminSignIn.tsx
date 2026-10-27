"use client";

import Link from "next/link";
import { Logo } from "@/components/atoms";
import { useMe } from "@/hooks/useApi";

/** The admin pages (the dashboard, the CMS) for someone who is not the administrator: who is signed in, and how to get
 * in (an administrator account: ADMIN_EMAILS or Admin → Settings → Administrators, then its daily emailed code). */
export function AdminSignIn() {
  const me = useMe();
  const email = me.data?.user?.email;
  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <section className="flex w-full max-w-sm min-w-0 flex-col gap-3 rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow)]" aria-label="Admin sign-in">
        <Logo height={72} className="mx-auto" />
        <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">Administration</span>
        <span className="m-0 text-[15px] font-bold">This part is for the administrator</span>
        <span className="text-[12.5px] text-muted">
          {email ? `${email} is not an administrator account. Sign out and sign in with the administrator's email.` : "Sign in with the administrator's email; a code is then emailed to it."}
        </span>
        <Link href="/login" className="inline-flex h-11 items-center justify-center rounded-xl bg-[image:var(--gold-gradient)] px-4 text-sm font-bold text-[var(--on-accent)]">
          {email ? "Sign in with another account" : "Sign in"}
        </Link>
        <Link href="/" className="text-center text-[12.5px] font-bold text-accent">
          Back to the studio
        </Link>
      </section>
    </div>
  );
}
