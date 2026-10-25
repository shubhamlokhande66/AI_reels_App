"use client";

import { useEffect } from "react";
import { DEFAULTS, type Features } from "@/lib/features-list";
import { useSafeQuery as useQuery } from "@/lib/useSafeQuery";
import { api } from "@/lib/api";
import { getAdminKey, setAdminKey } from "@/lib/admin";
import { DEFAULT_LOCKS, lockedFor, needMap, PLAN_NAME, type PlanId } from "@/lib/plan-locks";

/** The signed-in account (accounts on), or null; ``authEnabled`` false = a local studio without accounts. */
export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: 60_000, retry: false });
}

/** The signed-in user's credits (`enabled: false` when billing is off or nobody is signed in). */
export function useCredits() {
  const q = useQuery({ queryKey: ["credits"], queryFn: api.credits, staleTime: 15_000, refetchOnWindowFocus: true }); // no timer: each request keeps the server awake (Cloudflare); read again when the tab comes back and after each charge
  // the studio used credits (Shubix AI, a chat change): the balance everywhere is read again
  const { refetch } = q;
  useEffect(() => { const on = () => { void refetch(); }; window.addEventListener("brs-credits", on); return () => window.removeEventListener("brs-credits", on); }, [refetch]);
  return q;
}

/** Admin mode in this browser (settings and diagnostics are admin only; see lib/admin.ts). */
export function useAdmin(): { admin: boolean; required: boolean; loading: boolean } {
  const q = useQuery({
    queryKey: ["admin"],
    queryFn: async () => {
      const s = await api.adminSession();
      // an admin key the server no longer takes (ADMIN_KEY changed): forgotten, so it is not sent with every request
      // (wrong keys are counted against guessing, server/core/rateLimit.ts)
      if (!s.admin && getAdminKey()) setAdminKey(null);
      return s;
    },
    staleTime: 60_000,
    retry: false,
  });
  return { admin: q.data?.admin ?? false, required: q.data?.required ?? true, loading: q.isLoading };
}

export function useHealth() {
  return useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 60_000, retry: false }); // the admin's AI settings page only
}

/** Which parts of the app are on; everything counts as on until the answer arrives (nothing flickers away for most people). */
export function useFeatures(): Features {
  const q = useQuery({ queryKey: ["features"], queryFn: api.features, staleTime: 60_000, retry: false });
  return q.data ?? DEFAULTS;
}

/** What each plan unlocks (Admin → Settings → Plan locks). */
export function usePlanLocks() {
  return useQuery({ queryKey: ["plan-locks"], queryFn: api.planLocks, staleTime: 60_000, retry: false });
}
/** A page's lock for this person: null while it is not known yet, else (key) => the plan it needs ("Editor", "Pro"),
 * or "" when it is open (billing off, the administrator, or the plan has it). */
export function useLockCheck(): ((key: string) => string) | null {
  const L = usePlanLocks(), c = useCredits(), a = useAdmin();
  if (L.isLoading || c.isLoading || a.loading) return null;
  const need = needMap(L.data ?? DEFAULT_LOCKS), d = c.data;
  const open = (a.admin && a.required) || !d || (!d.enabled && !d.billing), plan = d?.enabled ? d.plan : "free";
  return (key) => (lockedFor(need[key], { plan, open }) ? PLAN_NAME[need[key] as PlanId] : "");
}
