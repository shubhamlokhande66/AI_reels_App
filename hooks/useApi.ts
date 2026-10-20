"use client";

import { DEFAULTS, type Features } from "@/lib/features-list";
import { useSafeQuery as useQuery } from "@/lib/useSafeQuery";
import { api } from "@/lib/api";
import { getAdminKey, setAdminKey } from "@/lib/admin";

/** The signed-in account (accounts on), or null; ``authEnabled`` false = a local studio without accounts. */
export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: 60_000, retry: false });
}

/** The signed-in user's credits (`enabled: false` when billing is off or nobody is signed in). */
export function useCredits() {
  return useQuery({ queryKey: ["credits"], queryFn: api.credits, staleTime: 15_000, refetchOnWindowFocus: true }); // no timer: each request keeps the server awake (Cloudflare); read again when the tab comes back and after each charge
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
