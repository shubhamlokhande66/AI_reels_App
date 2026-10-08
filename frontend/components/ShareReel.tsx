"use client";

import { useState, useSyncExternalStore } from "react";
import { assetUrl } from "@/lib/api";
import { btnSecondary } from "./ui";

/** Can this device share a video file (the phone's share sheet: Instagram, TikTok, WhatsApp …)? */
function canShareFiles(): boolean {
  try {
    const probe = new File([new Blob()], "reel.mp4", { type: "video/mp4" });
    return typeof navigator !== "undefined" && !!navigator.canShare && navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/** Share the finished Reel through the device's share sheet. Shown only where that works (phones, some desktops). */
export function ShareReel({ url, name }: { url: string; name: string }) {
  const supported = useSyncExternalStore(() => () => {}, canShareFiles, () => false);
  const [state, setState] = useState<"idle" | "preparing" | "error">("idle");
  if (!supported) return null;

  async function share() {
    setState("preparing");
    try {
      const blob = await (await fetch(assetUrl(url) ?? url)).blob();
      const file = new File([blob], `${name.replace(/[^\w.-]+/g, "-") || "reel"}.mp4`, { type: "video/mp4" });
      await navigator.share({ files: [file], title: name });
      setState("idle");
    } catch (e) {
      setState((e as Error)?.name === "AbortError" ? "idle" : "error"); // closing the share sheet is not an error
    }
  }

  return (
    <button type="button" className={btnSecondary} onClick={() => void share()} disabled={state === "preparing"}>
      {state === "preparing" ? "Preparing…" : state === "error" ? "Share failed: try again" : "↗ Share"}
    </button>
  );
}
