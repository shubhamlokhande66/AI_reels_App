import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { settings } from "@/server/core/config";
import { ValidationFailed } from "@/server/core/errors";
import { clean } from "@/server/ai/text";
import { transcribe } from "@/server/ai/transcribe";
import { charge, costOf, enabled as creditsOn, refund } from "@/server/credits";

/** Fast Studio captions: the words of the song (lyrics or speech), with their times, so the phone can show them word by
 * word on the beat. The phone sends the song already reduced to what speech recognition needs (16 kHz mono 16-bit WAV,
 * the vocal band); the server's transcriber does the rest (local Whisper when installed, else OpenAI's Whisper API). */

export const COST_ACTION = "studio_captions";
export const LANGS = ["", "en", "hi", "mr", "gu", "pa", "bn", "ta", "te", "kn", "ml", "ur"] as const;
export const LIMITS = { seconds: 180, bytes: 44 + 180 * 16000 * 2 } as const;

export interface CaptionWord { text: string; start: number; end: number }

/** A 16 kHz mono 16-bit PCM WAV, or a clear error. Returns its length in seconds. */
export function checkWav(buf: Buffer): number {
  if (buf.length < 44 || buf.length > LIMITS.bytes) throw new ValidationFailed(`The audio must be a WAV of at most ${LIMITS.seconds} s.`, { code: "CAPTIONS_AUDIO" });
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new ValidationFailed("The audio must be a WAV file.", { code: "CAPTIONS_AUDIO" });
  let o = 12, fmt = false, data = 0;
  while (o + 8 <= buf.length) {
    const id = buf.toString("ascii", o, o + 4), size = buf.readUInt32LE(o + 4);
    if (id === "fmt ") {
      const pcm = buf.readUInt16LE(o + 8), ch = buf.readUInt16LE(o + 10), sr = buf.readUInt32LE(o + 12), bits = buf.readUInt16LE(o + 22);
      if (pcm !== 1 || ch !== 1 || sr !== 16000 || bits !== 16) throw new ValidationFailed("The audio must be 16 kHz mono 16-bit PCM.", { code: "CAPTIONS_AUDIO" });
      fmt = true;
    }
    if (id === "data") { data = Math.min(size, buf.length - o - 8); break; }
    o += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new ValidationFailed("The WAV has no audio.", { code: "CAPTIONS_AUDIO" });
  return data / 2 / 16000;
}

/** Words the phone can trust: text trimmed and short, times inside the song and in order, at most 3000. */
export function cleanWords(words: { text: string; start: number | null; end: number | null }[], duration: number): CaptionWord[] {
  const out: CaptionWord[] = [];
  for (const w of words) {
    const text = clean(w.text, 40).replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, "");
    const start = Number(w.start), end0 = Number(w.end);
    if (!text || !Number.isFinite(start)) continue;
    const s = Math.min(Math.max(0, start), duration), e = Math.min(Math.max(s + 0.05, Number.isFinite(end0) ? end0 : s + 0.3), duration, s + 3);
    out.push({ text, start: Math.round(s * 1000) / 1000, end: Math.round(e * 1000) / 1000 });
    if (out.length >= 3000) break;
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

let localWhisper: boolean | null = null;
async function hasLocalWhisper() {
  if (localWhisper !== null) return localWhisper;
  try { await import(/* webpackIgnore: true */ "@huggingface/transformers" as string); localWhisper = true; } catch { localWhisper = false; }
  return localWhisper;
}
export async function availability() {
  let credits = 0;
  if (creditsOn()) { try { credits = await costOf(COST_ACTION); } catch { /* prices unreadable: the charge decides */ } }
  return { available: (await hasLocalWhisper()) || Boolean(settings.openaiApiKey.trim()), credits, languages: LANGS.filter(Boolean) };
}

export async function captionSong(wav: Buffer, language: string) {
  const lang = (LANGS as readonly string[]).includes(language) ? language : "";
  const duration = checkWav(wav);
  const ref = `studio_captions_${crypto.randomUUID().slice(0, 12)}`;
  const charged = await charge(COST_ACTION, ref, "Captions in Fast Studio");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio_cap_")), file = path.join(dir, "song.wav");
  try {
    fs.writeFileSync(file, wav);
    const words = await transcribe(file, 0, duration, () => {}, lang);
    return { words: cleanWords(words, duration), duration, language: lang || "auto", charged };
  } catch (e) {
    if (charged) await refund(ref);
    throw e;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
