"use client";

import { Spinner } from "@/components/atoms/Spinner";
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
  if (!check || need) return <div className="grid min-h-[40vh] place-items-center" aria-busy="true"><Spinner label={need ? "This is in a paid plan: opening the plans…" : "Checking your plan…"} /></div>; // not known yet, or on its way to the plans
  return <>{children}</>;
}
