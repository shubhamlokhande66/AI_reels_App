"use client";

import { useSyncExternalStore } from "react";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { SpinnerIcon } from "@/components/atoms/Spinner";
import { activityCount, subscribeActivity } from "@/lib/activity";

/** The app's loading feedback, the same everywhere:
 * - an action on its way to the server (generate, save, delete, upload …): the bar across the top, a "Working…" note,
 *   and a spinner inside the button that started it (lib/activity.ts);
 * - data loading for the first time (any query without data yet): the bar across the top, while the page shows its
 *   centred <Spinner /> or skeletons. Background refreshes stay quiet. */
export function GlobalActivity() {
  const requests = useSyncExternalStore(subscribeActivity, activityCount, () => 0);
  const acting = useIsMutating() > 0 || requests > 0;
  const loading = useIsFetching({ predicate: (q) => q.state.data === undefined }) > 0;
  if (!acting && !loading) return null;
  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[90] h-[3px] overflow-hidden" role="progressbar" aria-label={acting ? "Working" : "Loading"} aria-busy="true">
        <div className="h-full w-1/3 animate-sweep bg-gold shadow-[0_0_12px_color-mix(in_srgb,var(--accent)_80%,transparent)]" />
      </div>
      {acting && (
        <div
          role="status"
          className="animate-enter motion-reduce:animate-none pointer-events-none fixed bottom-[calc(96px+env(safe-area-inset-bottom))] right-4 z-[90] flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold shadow-[0_12px_30px_-14px_rgba(0,0,0,.6)] md:bottom-5 md:right-5"
        >
          <SpinnerIcon size={16} className="text-accent" />
          Working…
        </div>
      )}
    </>
  );
}
