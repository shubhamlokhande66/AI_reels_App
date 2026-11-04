import { STUDIO_HTML } from "@/components/studio/markup";
import { initViews } from "@/components/studio/views";
import { initSteps } from "@/components/studio/steps";
import { initAuto } from "@/components/studio/auto";
import { initFlow } from "@/components/studio/flow";
import { TTS_VOICES } from "@/lib/tts/voices";
import "@/components/studio/studio.css";

/** The phone app's own hidden engine page (lib/engine.tsx keeps it unseen). It is built by engine/build.mjs, goes inside
 * the APK and is served by the app itself (FileServer.kt): nothing here comes from the website, and the website's code
 * is not used, so changing or deploying the website does not change the phone. The phone works it through
 * components/studio/bridge.ts. */
const loadScript = (src: string) => new Promise<void>((resolve) => {
  const s = document.createElement("script");
  s.src = src; s.async = false;
  s.onload = () => resolve();
  s.onerror = () => resolve(); // faces are optional: the edit still works without them
  document.head.appendChild(s);
});

async function start() {
  const root = document.getElementById("studio") as HTMLDivElement;
  root.className = "brs fopen";
  root.dataset.fstep = "intro";
  root.dataset.fkind = "music";
  root.innerHTML = STUDIO_HTML;
  initViews(root, () => {});
  initSteps(root);
  initAuto(root);
  initFlow(root);
  await loadScript("/vendor/tracking/tracking-min.js");
  await loadScript("/vendor/tracking/face-min.js");
  const { initStudio } = await import("@/components/studio/engine");
  initStudio(root, {
    loadMediabunny: () => import("mediabunny"),
    loadAacEncoder: () => import("@mediabunny/aac-encoder"),
    beatThis: (mono: Float32Array, sr: number, onProgress?: (stage: "download" | "run", p: number) => void) =>
      import("@/lib/beatThis/client").then((m) => m.beatThisOnDevice(mono, sr, onProgress)),
    speechProbs: (mono: Float32Array, sr: number) => import("@/lib/vad/client").then((m) => m.speechProbs(mono, sr)),
    loadRnnoise: () => import("@shiguredo/rnnoise-wasm"),
    tts: {
      voices: TTS_VOICES,
      speak: (text: string, voice: string, onProgress?: (p: import("@/lib/tts/client").TtsProgress) => void) =>
        import("@/lib/tts/client").then((m) => m.speak(text, voice, onProgress)),
    },
    cloud: {
      usage: () => import("@/lib/cloudReels").then((m) => m.cloudUsage()),
      save: (blob: Blob, meta: import("@/lib/cloudReels").SaveMeta, onProgress?: (p: number) => void) =>
        import("@/lib/cloudReels").then((m) => m.saveToCloud(blob, meta, onProgress)),
    },
    personMask: (rgba: Uint8ClampedArray) => import("@/lib/vision/client").then((m) => m.personMask(rgba)),
    findFaces: (squares: Uint8ClampedArray[]) => import("@/lib/vision/client").then((m) => m.findFaces(squares)),
  });
  const { initBridge } = await import("@/components/studio/bridge");
  initBridge(root);
}

start().catch((e) => console.error("The engine could not start:", e));
