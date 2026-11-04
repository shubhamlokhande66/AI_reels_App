/** Text to speech: the phone's own voices (SystemVoice.kt, through the app's file server). Nothing is uploaded by us. */

import { phoneModels } from "../nativeModels";
import { voiceLanguage } from "./voices";
export { TTS_VOICES, type TtsVoice } from "./voices";

export type TtsProgress = { stage: "speak"; p: number };

// long text: by sentences (a few hundred letters at most each), joined with a short pause
function chunks(text: string, max = 300): string[] {
  const out: string[] = []; let cur = "";
  for (const s of text.match(/[^.!?।\n]+[.!?।]*\s*/g) ?? [text]) {
    if ((cur + s).length > max && cur.trim()) { out.push(cur.trim()); cur = ""; }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export async function speak(text: string, voice: string, onProgress?: (p: TtsProgress) => void): Promise<{ pcm: Float32Array; sr: number }> {
  const n = phoneModels();
  if (!n) throw new Error("Text to speech works in the app");
  const parts = chunks(text), pcms: Float32Array[] = [];
  let sr = 22050;
  for (let k = 0; k < parts.length; k++) {
    onProgress?.({ stage: "speak", p: k / parts.length });
    const res = await fetch(`${n.base}/speak?k=${n.key}&v=${encodeURIComponent(voiceLanguage(voice))}`, { method: "POST", body: parts[k] });
    if (!res.ok) throw new Error(await res.text());
    sr = Number(res.headers.get("X-Sample-Rate")) || sr;
    pcms.push(new Float32Array(await res.arrayBuffer()));
    if (k < parts.length - 1) pcms.push(new Float32Array(Math.round(0.18 * sr)));
  }
  const pcm = new Float32Array(pcms.reduce((a, p) => a + p.length, 0)); let at = 0;
  for (const p of pcms) { pcm.set(p, at); at += p.length; }
  return { pcm, sr };
}
