"use client";

import { useSyncExternalStore } from "react";
import { useIsMutating } from "@tanstack/react-query";
import { activityCount, subscribeActivity } from "@/lib/activity";

/** Whenever an action is on its way to the server (generate, regenerate, save, delete, upload …) a gold activity bar
 * runs across the top of the window and a small "Working…" note appears, so no click ever seems to do nothing. */
export function GlobalActivity() {
  const requests = useSyncExternalStore(subscribeActivity, activityCount, () => 0);
  const busy = useIsMutating() > 0 || requests > 0;
  if (!busy) return null;
  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[90] h-[3px] overflow-hidden" role="progressbar" aria-label="Working" aria-busy="true">
        <div className="lux-activity h-full w-1/3" />
      </div>
      <div
        role="status"
        className="lux-card lux-enter pointer-events-none fixed bottom-5 right-5 z-[90] flex items-center gap-2 rounded-full px-4 py-2 text-sm"
      >
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent/25 border-t-accent" />
        Working…
      </div>
    </>
  );
}
