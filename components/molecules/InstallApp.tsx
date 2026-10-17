"use client";

import { useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/atoms/Icon";
import { canInstall, install, isIos, isStandalone, subscribeInstall } from "@/lib/pwa";

/** "Install the app": the browser's install offer (Android, Chrome, Edge), or the steps for iPhone (Share → Add to Home
 * Screen). Hidden once Shubix runs as an installed app. */
export function InstallApp({ className = "" }: { className?: string }) {
  const offer = useSyncExternalStore(subscribeInstall, canInstall, () => false);
  const standalone = useSyncExternalStore(subscribeInstall, isStandalone, () => true);
  const ios = useSyncExternalStore(() => () => {}, isIos, () => false);
  const [howTo, setHowTo] = useState(false);
  if (standalone || (!offer && !ios)) return null;
  return (
    <div className={className}>
      <button type="button" className="btn sm w-full" onClick={() => (offer ? void install() : setHowTo((v) => !v))}>
        <Icon name="download" size={16} />
        Install the Shubix app
      </button>
      {howTo && (
        <p className="mu xs mt-2 leading-snug">
          On iPhone: tap the <b>Share</b> button in Safari, then <b>Add to Home Screen</b>. Shubix then opens full screen like any app.
        </p>
      )}
    </div>
  );
}
