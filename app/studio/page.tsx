"use client";

import { useEffect, useRef, useState } from "react";
import { STUDIO_HTML } from "@/components/studio/markup";
import "@/components/studio/studio.css";

/**
 * Fast Studio: song + clips -> a finished, beat-synced Reel made entirely on this device (analysis, edit, GPU preview and a
 * WebCodecs MP4 export). Nothing is uploaded, so it is fast and costs no server time. The editor itself is plain DOM code
 * (components/studio/engine.ts) mounted into this page once.
 */

const SCRIPTS = ["/vendor/tracking/tracking-min.js", "/vendor/tracking/face-min.js"]; // face finder (BSD), loaded in order

function loadScript(src: string): Promise<void> {
  return new Promise((resolve) => {
    if (document.querySelector(`script[data-studio="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = false;
    s.dataset.studio = src;
    s.onload = () => resolve();
    s.onerror = () => resolve(); // faces are optional: the edit still works without them
    document.head.appendChild(s);
  });
}

export default function FastStudioPage() {
  const root = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        for (const src of SCRIPTS) await loadScript(src);
        const { initStudio } = await import("@/components/studio/engine");
        if (cancelled || !root.current) return;
        cleanup = initStudio(root.current, { loadMediabunny: () => import("mediabunny") });
      } catch (e) {
        setFailed(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return (
    <div className="mx-auto w-full max-w-6xl">
      {failed && <p className="mb-4 rounded-lg border border-danger p-3 text-sm text-danger">Fast Studio could not start: {failed}</p>}
      <div ref={root} className="brs" dangerouslySetInnerHTML={{ __html: STUDIO_HTML }} />
    </div>
  );
}
