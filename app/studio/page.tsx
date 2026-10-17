"use client";

import { useEffect, useRef, useState } from "react";
import { STUDIO_HTML } from "@/components/studio/markup";
import { initViews } from "@/components/studio/views";
import { ErrorBanner } from "@/components/molecules";
import "@/components/studio/studio.css";

/**
 * Fast Studio: song + clips -> a finished, beat-synced Reel made entirely on this device (analysis, edit, GPU preview and a
 * WebCodecs MP4 export). Nothing is uploaded, so it is fast and costs no server time. The editor itself is plain DOM code
 * (components/studio/engine.ts) mounted into this page once; components/studio/views.ts switches its Simple / Editor /
 * Pro views. It sits inside the app like every other page: the same sidebar, top bar, menu and footer.
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
    const el = root.current!;
    const v = initViews(el, () => {});
    (async () => {
      try {
        for (const src of SCRIPTS) await loadScript(src);
        const { initStudio } = await import("@/components/studio/engine");
        if (cancelled || !root.current) return;
        cleanup = initStudio(root.current, {
          loadMediabunny: () => import("mediabunny"),
          // AAC for the export on browsers whose WebCodecs has no AAC encoder (Safari before 26, i.e. most iPhones today)
          loadAacEncoder: () => import("@mediabunny/aac-encoder"),
          // the on-device AI beat tracker (Beat This!, ONNX Runtime WebAssembly, in a worker); loaded only when a song is
          beatThis: (mono: Float32Array, sr: number, onProgress?: (stage: "download" | "run", p: number) => void) =>
            import("@/lib/beatThis/client").then((m) => m.beatThisOnDevice(mono, sr, onProgress)),
          // where people speak in a clip (Silero VAD in a worker), for cutting the silences of talking videos
          speechProbs: (mono: Float32Array, sr: number) => import("@/lib/vad/client").then((m) => m.speechProbs(mono, sr)),
          // who is the person (background blur / replace, text behind the person) and where faces are (MediaPipe models)
          // voice noise cleanup (RNNoise, WebAssembly), loaded only for talking videos and voiceovers
          loadRnnoise: () => import("@shiguredo/rnnoise-wasm"),
          // My Reels: "Export & save" keeps the finished Reel in the account (straight to storage, lib/cloudReels.ts)
          cloud: {
            usage: () => import("@/lib/cloudReels").then((m) => m.cloudUsage()),
            save: (blob: Blob, meta: import("@/lib/cloudReels").SaveMeta, onProgress?: (p: number) => void) =>
              import("@/lib/cloudReels").then((m) => m.saveToCloud(blob, meta, onProgress)),
          },
          personMask: (rgba: Uint8ClampedArray) => import("@/lib/vision/client").then((m) => m.personMask(rgba)),
          findFaces: (squares: Uint8ClampedArray[]) => import("@/lib/vision/client").then((m) => m.findFaces(squares)),
        });
      } catch (e) {
        setFailed(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      v.cleanup();
      cleanup?.();
    };
  }, []);

  return (
    <>
      {failed && <ErrorBanner title="Fast Studio could not start" message={failed} onRetry={() => location.reload()} />}
      <div ref={root} className="brs" dangerouslySetInnerHTML={{ __html: STUDIO_HTML }} />
    </>
  );
}
