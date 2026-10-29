"use client";

import { useState, useSyncExternalStore } from "react";
import { canInstall, install, isIos, isStandalone, subscribeInstall } from "@/lib/pwa";
import { useText } from "@/hooks/useApi";
import { Button } from "@/components/atoms/Button";
import { RichText } from "./RichText";

/** "Install the app": the browser's install offer (Android, Chrome, Edge), or the steps for iPhone (Share → Add to Home
 * Screen). Hidden once Shubix runs as an installed app. */
export function InstallApp({ className = "" }: { className?: string }) {
  const text = useText();
  const offer = useSyncExternalStore(subscribeInstall, canInstall, () => false);
  const standalone = useSyncExternalStore(subscribeInstall, isStandalone, () => true);
  const ios = useSyncExternalStore(() => () => {}, isIos, () => false);
  const [howTo, setHowTo] = useState(false);
  if (standalone || (!offer && !ios)) return null;
  return (
    <div className={className}>
      <Button size="sm" variant="secondary" full icon="download" onClick={() => (offer ? void install() : setHowTo((v) => !v))}>{text("install.sidebar")}</Button>
      {howTo && (
        <div className="mt-2 text-[11px] leading-snug text-muted">
          <RichText text={text("install.ios")} />
        </div>
      )}
    </div>
  );
}
