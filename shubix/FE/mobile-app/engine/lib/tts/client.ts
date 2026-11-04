/** Fast Studio's text to speech on the phone (lib/tts/tts.worker.ts): Piper voices, downloaded once from
 * rhasspy/piper-voices (Hugging Face) and kept on the phone. Nothing is uploaded. */

import { voiceUrl } from "./voices";
export { TTS_VOICES, voiceUrl, type TtsVoice } from "./voices";

let worker: Worker | null = null, nextId = 1;
export type TtsProgress = { stage: "download" | "speak"; p: number };

export function speak(text: string, voice: string, onProgress?: (p: TtsProgress) => void): Promise<{ pcm: Float32Array; sr: number }> {
  if (typeof Worker === "undefined" || typeof WebAssembly === "undefined") return Promise.reject(new Error("no WebAssembly here"));
  worker ??= new Worker("/w/tts.worker.js", { type: "module" });
  const w = worker, id = nextId++, u = voiceUrl(voice);
  return new Promise((resolve, reject) => {
    const done = () => { w.removeEventListener("message", onMsg); w.removeEventListener("error", onErr); };
    const onMsg = (e: MessageEvent) => { const d = e.data; if (d.id !== id) return;
      if (d.type === "progress") { onProgress?.({ stage: d.stage, p: d.p }); return; }
      done(); if (d.type === "done") resolve({ pcm: d.pcm, sr: d.sr }); else reject(new Error(d.message)); };
    const onErr = (e: ErrorEvent) => { done(); worker = null; reject(new Error(e.message || "voice worker failed")); };
    w.addEventListener("message", onMsg); w.addEventListener("error", onErr);
    w.postMessage({ id, text, model: u.model, config: u.config, wasm: new URL("/vendor/ort/", location.href).href, piper: new URL("/vendor/piper/", location.href).href });
  });
}

/** Is this voice already on the phone? (then adding speech starts at once) */
export async function voiceStored(voice: string): Promise<boolean> {
  try { const c = await caches.open("brs-models-v1"); return !!(await c.match(voiceUrl(voice).model)); } catch { return false; }
}
