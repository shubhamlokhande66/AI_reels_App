"use client";

import { useSyncExternalStore } from "react";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { activityCount, subscribeActivity } from "@/lib/activity";

/** The app's loading feedback, the same everywhere:
 * - an action on its way to the server (generate, save, delete, upload …): the bar across the top,
 *   and a spinner inside the button that started it (lib/activity.ts);
 * - data loading for the first time (any query without data yet): the bar across the top, while the page shows its
 *   centred <Spinner /> or skeletons. Background refreshes stay quiet. */
export function GlobalActivity() {
  const requests = useSyncExternalStore(subscribeActivity, activityCount, () => 0);
  const acting = useIsMutating() > 0 || requests > 0;
  const loading = useIsFetching({ predicate: (q) => q.state.data === undefined }) > 0;
  if (!acting && !loading) return null;
  return (
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[90] h-[3px] overflow-hidden" role="progressbar" aria-label={acting ? "Working" : "Loading"} aria-busy="true">
        <div className="h-full w-1/3 animate-sweep bg-gold shadow-[0_0_12px_color-mix(in_srgb,var(--accent)_80%,transparent)]" />
      </div>
  );
}
