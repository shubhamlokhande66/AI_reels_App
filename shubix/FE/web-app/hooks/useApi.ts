"use client";

import { useEffect } from "react";
import { DEFAULTS, type Features } from "@shubix/core/lib/features-list";
import { useSafeQuery as useQuery } from "@/lib/useSafeQuery";
import { api } from "@/lib/api";
import { DEFAULT_LOCKS, lockedFor, needMap, type PlanId } from "@shubix/core/lib/plan-locks";
import { fill, TEXT_DEFAULTS, type Texts } from "@shubix/core/lib/texts";
import { listDef, type ListItem } from "@shubix/core/lib/collections";

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
/** still waiting for a first answer. A query that already failed once is not waited for again: with no data, a refetch
 * (another part of the page asking) puts it back to "pending", and a gate that waits on it would hide its page, the
 * page's parts would ask again, and so on, for ever. */
const waiting = (q: { isLoading: boolean; errorUpdatedAt: number }) => q.isLoading && !q.errorUpdatedAt;

/** otp: an admin account is signed in but its daily admin code is due (the admin pages ask for it) */
export function useAdmin(): { admin: boolean; required: boolean; otp: boolean; loading: boolean } {
  const q = useQuery({
    queryKey: ["admin"],
    queryFn: () => {
      try { localStorage.removeItem("reel-admin-key"); } catch { /* an admin password kept before there were admin emails: gone */ }
      return api.adminSession();
    },
    staleTime: 60_000,
    retry: false,
  });
  return { admin: q.data?.admin ?? false, required: q.data?.required ?? true, otp: q.data?.otp ?? false, loading: waiting(q) };
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
// the texts last seen on this device: a page shows the administrator's wording at once, without the defaults flashing first
const TEXTS_KEY = "shubix-texts";
function savedTexts(): Texts | undefined {
  try { const s = typeof window !== "undefined" ? window.localStorage.getItem(TEXTS_KEY) : null; return s ? (JSON.parse(s) as Texts) : undefined; } catch { return undefined; }
}
export function useTexts() {
  return useQuery({
    queryKey: ["texts"],
    queryFn: async () => { const t = await api.texts(); try { window.localStorage.setItem(TEXTS_KEY, JSON.stringify(t)); } catch { /* private mode: read again next time */ } return t; },
    initialData: savedTexts, initialDataUpdatedAt: 0, staleTime: 60_000, retry: false,
  });
}
/** t("pricing.title1"), t("pricing.choose", { plan: "Pro" }): the administrator's text (Admin → CMS) or
 * the default (lib/texts.ts). */
export function useT() {
  const q = useTexts(), saved = q.data;
  return (key: string, vars?: Record<string, string | number>) => fill(saved?.[key] ?? TEXT_DEFAULTS[key] ?? key, vars);
}
export type TFn = ReturnType<typeof useT>;

/** The administrator's lists (Admin → CMS) */
export function useContent() {
  return useQuery({ queryKey: ["content"], queryFn: api.content, staleTime: 60_000, retry: false });
}
/** A list's items: the administrator's (Admin → CMS), else its first items (lib/collections.ts). */
export function useList(id: string): ListItem[] {
  const q = useContent();
  return q.data?.[id] ?? listDef(id).items;
}

export function usePlanLocks() {
  return useQuery({ queryKey: ["plan-locks"], queryFn: api.planLocks, staleTime: 60_000, retry: false });
}
/** A page's lock for this person: null while it is not known yet, else (key) => the plan it needs ("creator", "pro"),
 * or "" when it is open (billing off, the administrator, or the plan has it). */
/** Whether a plan is out of this person's reach: null while it is not known yet, else (need) => true when it is
 * locked (billing on, not the administrator, and their plan is lower). For things with their own plan (a template). */
export function usePlanNeed(): ((need: PlanId | undefined) => boolean) | null {
  const c = useCredits(), a = useAdmin();
  if (waiting(c) || a.loading) return null;
  const d = c.data, open = (a.admin && a.required) || !d || (!d.enabled && !d.billing), plan = d?.enabled ? d.plan : "free";
  return (need) => lockedFor(need, { plan, open });
}

export function useLockCheck(): ((key: string) => PlanId | "") | null {
  const L = usePlanLocks(), c = useCredits(), a = useAdmin();
  if (waiting(L) || waiting(c) || a.loading) return null;
  const need = needMap(L.data ?? DEFAULT_LOCKS), d = c.data;
  const open = (a.admin && a.required) || !d || (!d.enabled && !d.billing), plan = d?.enabled ? d.plan : "free";
  return (key) => (lockedFor(need[key], { plan, open }) ? (need[key] as PlanId) : "");
}
