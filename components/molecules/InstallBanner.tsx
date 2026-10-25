"use client";

import { useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/atoms/Icon";
import { useMe, useT } from "@/hooks/useApi";
import { canInstall, install, isIos, isStandalone, subscribeInstall } from "@/lib/pwa";
import { Button, IconButton } from "@/components/atoms";
import { RichText } from "./RichText";
import { cn } from "@/lib/cn";

/** "Get the Shubix app", at the top of every page until the app is installed:
 * - Android, computers (Chrome, Edge): Install installs it at once (the browser's own offer, lib/pwa.ts). The browser offers
 *   it only while the app is not installed, and again after it was removed, so the banner follows that offer
 * - iPhone / iPad: a website cannot install itself there (Apple gives Safari no install offer), so Install shows the two
 *   taps below the banner (Share, Add to Home Screen). Safari cannot see the home screen app either, so the app tells the account when it is opened (usePresence);
 *   not opened for 14 days, it was most likely removed, and the banner comes back (server/accounts.ts me, iosApp)
 * Never inside the installed app. "Not now" hides it until the browser tab is closed. */
const LATER = "shubix-install-later";

/** In the sticky header, top right (AppShell): a pill on computers ("Get the app · Install · ✕"); `compact` on phones,
 * a round install button. On an iPhone, Install opens the two taps in a small card under it. */
export function InstallBanner({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  const t = useT();
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
  const go = () => (offer ? void install() : setHowTo((v) => !v));
  return (
    <div role="region" aria-label={t("install.sidebar")} className={cn("relative", className)}>
      {compact ? (
        <IconButton icon="download" label={t("install.button")} title={t("install.title")} onClick={go} className="border-accent/50 text-accent" />
      ) : (
        <div className="flex h-10 items-center gap-1 rounded-full border border-accent/40 bg-accent/10 py-1 pl-3 pr-1" title={`${t("install.title")} · ${t("install.sub")}`}>
          <Icon name="download" size={16} className="shrink-0 text-accent" />
          <span className="hidden whitespace-nowrap text-[13px] font-semibold xl:inline">{t("install.title")}</span>
          <Button size="sm" className="ml-1 h-8 rounded-full px-3" onClick={go}>{t("install.button")}</Button>
          <IconButton icon="close" plain size={28} iconSize={14} label={t("install.notNow")} className="text-muted" onClick={notNow} />
        </div>
      )}
      {/* iPhone: a website cannot install itself, so the two taps */}
      {howTo && !offer && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-[min(300px,calc(100vw-32px))] rounded-2xl border border-border bg-surface p-3.5 text-[12.5px] leading-snug text-muted shadow-[0_20px_44px_-18px_rgba(0,0,0,.6)]">
          <b className="mb-1 block text-[13px] text-foreground">{t("install.title")}</b>
          <RichText text={t("install.ios")} />
          {compact && <button type="button" onClick={notNow} className="mt-2 text-[12px] font-semibold text-muted hover:text-foreground">{t("install.notNow")}</button>}
        </div>
      )}
    </div>
  );
}
