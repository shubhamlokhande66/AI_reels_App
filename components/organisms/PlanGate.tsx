"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/atoms/Icon";
import { btnPrimary } from "@/components/atoms/Button";
import { useLockCheck } from "@/hooks/useApi";

const NAMES: Record<string, string> = { "page:copy": "Copy a Reel", "page:templates": "Templates", "page:story": "Story Maker", "page:brand": "Brand kit" };

/** A page that opens on a plan (lib/plan-locks.ts "page:…"): on a lower plan, the way to upgrade instead of the page. */
export function PlanGate({ item, children }: { item: string; children: ReactNode }) {
  const check = useLockCheck();
  if (!check) return <div className="min-h-[40vh]" aria-busy="true" />; // not known yet: the page waits a moment
  const need = check(item);
  if (!need) return <>{children}</>;
  const name = NAMES[item] ?? "This page";
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-3xl border border-border bg-surface p-8 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent/15 text-accent"><Icon name="lock" size={26} /></span>
      <h1 className="text-xl font-bold">{name} is in the {need} plan</h1>
      <p className="text-sm text-muted">Upgrade to {need} to use {name}. Your Reels and drafts stay as they are.</p>
      <Link href={`/pricing?need=${encodeURIComponent(item)}`} className={btnPrimary}>Upgrade to {need}</Link>
      <Link href="/" className="text-sm text-muted underline">Back to Home</Link>
    </div>
  );
}
