"use client";

import { useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/atoms/Icon";
import { useMe } from "@/hooks/useApi";
import { canInstall, install, isIos, isStandalone, subscribeInstall } from "@/lib/pwa";

/** "Get the Shubix app", at the top of every page until the app is installed:
 * - Android, computers (Chrome, Edge): Install installs it at once (the browser's own offer, lib/pwa.ts). The browser offers
 *   it only while the app is not installed, and again after it was removed, so the banner follows that offer
 * - iPhone / iPad: a website cannot install itself there (Apple gives Safari no install offer), so Install shows the two
 *   taps below the banner (Share, Add to Home Screen). Safari cannot see the home screen app either, so the app tells the account when it is opened (usePresence);
 *   not opened for 14 days, it was most likely removed, and the banner comes back (server/accounts.ts me, iosApp)
 * Never inside the installed app. "Not now" hides it until the browser tab is closed. */
const LATER = "shubix-install-later";

export function InstallBanner({ className = "" }: { className?: string }) {
  const offer = useSyncExternalStore(subscribeInstall, canInstall, () => false);
  const standalone = useSyncExternalStore(subscribeInstall, isStandalone, () => true);
  const ios = useSyncExternalStore(() => () => {}, isIos, () => false);
  const me = useMe();
  const [howTo, setHowTo] = useState(false);
  const [later, setLater] = useState(() => {
    try {
      return sessionStorage.getItem(LATER) === "1";
    } catch {
      return false;
    }
  });
  if (standalone || later) return null;
  if (!offer && !(ios && !me.data?.user?.iosApp)) return null;
  const notNow = () => {
    try {
      sessionStorage.setItem(LATER, "1");
    } catch {}
    setLater(true);
  };
  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      <div role="region" aria-label="Install the Shubix app" className="flex max-w-full items-center gap-2.5 rounded-full border border-border bg-surface-2 py-1.5 pl-3 pr-1.5 shadow-sm">
        <Icon name="download" size={18} className="shrink-0 text-accent" />
        <span className="min-w-0 text-sm leading-tight">
          <b>Get the Shubix app</b>
          <span className="text-muted hidden sm:inline"> · full screen, one tap from your home screen</span>
        </span>
        <button type="button" className="btn sm g shrink-0" onClick={() => (offer ? void install() : setHowTo(true))}>
          Install
        </button>
        <button type="button" aria-label="Not now" title="Not now" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted hover:text-foreground" onClick={notNow}>
          <Icon name="close" size={16} />
        </button>
      </div>
      {howTo && !offer && (
        <p className="max-w-sm text-center text-xs leading-snug text-muted">
          In Safari, tap the <b>Share</b> button <Icon name="share" size={13} className="inline align-[-2px]" />, then <b>Add to Home Screen</b>. Shubix then opens full screen like any app.
        </p>
      )}
    </div>
  );
}
