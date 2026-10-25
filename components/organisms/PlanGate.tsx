"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useLockCheck } from "@/hooks/useApi";

/** A page that opens on a plan (lib/plan-locks.ts "page:…"): on a lower plan, straight to the plans instead. */
export function PlanGate({ item, children }: { item: string; children: ReactNode }) {
  const check = useLockCheck(), router = useRouter();
  const need = check ? check(item) : "";
  useEffect(() => {
    if (need) router.replace(`/pricing?need=${encodeURIComponent(item)}`);
  }, [need, item, router]);
  if (!check || need) return <div className="min-h-[40vh]" aria-busy="true" />; // not known yet, or on its way to the plans
  return <>{children}</>;
}
