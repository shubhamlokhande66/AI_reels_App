"use client";

import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/molecules/Toaster";
import { errorMessage } from "@/lib/api";
import { toast } from "@/lib/toast";
import { useEffect, useState } from "react";
import { startPwa } from "@/lib/pwa";

export function makeQueryClient() {
  return new QueryClient({
    // every action says how it went: meta.success pops up after it worked; an error pops up unless the page shows it
    // itself (meta.errorShown)
    mutationCache: new MutationCache({
      onSuccess: (_d, _v, _c, m) => { const s = m.meta?.success; if (typeof s === "string") toast.success(s); },
      onError: (e, _v, _c, m) => { if (!m.meta?.errorShown) toast.error(errorMessage(e)); },
    }),
    defaultOptions: { queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: false } },
  });
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(makeQueryClient);
  useEffect(() => startPwa(), []); // the installable app: service worker and install offer
  return <QueryClientProvider client={client}>{children}<Toaster /></QueryClientProvider>;
}
