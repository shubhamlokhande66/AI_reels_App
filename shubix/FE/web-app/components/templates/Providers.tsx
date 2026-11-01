"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { startPwa } from "@/lib/pwa";

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: false } },
  });
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(makeQueryClient);
  useEffect(() => startPwa(), []); // the installable app: service worker and install offer
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
