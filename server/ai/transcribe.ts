import "server-only";
import { spawn } from "node:child_process";
import { settings } from "@/server/core/config";
import { AppError } from "@/server/core/errors";
import { findBinary } from "@/server/core/ffmpeg";

/** Speech recognition for captions: word timings from local Whisper or OpenAI's API. */

export type Word = { text: string; start: number; end: number };
export class CaptionsUnavailable extends AppError { constructor(message: string, details: unknown = null) { super(message, { code: "CAPTIONS_UNAVAILABLE", status: 503, details }); } }

/** 16 kHz mono float samples of a window of a file. */
function decode16k(file: string, start: number, duration: number): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const p = spawn(findBinary("ffmpeg"), ["-hide_banner", "-loglevel", "error", "-ss", start.toFixed(3), "-t", duration.toFixed(3), "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "pipe:1"], { windowsHide: true });
    const chunks: Buffer[] = [];
    p.stdout.on("data", (c: Buffer) => chunks.push(c));
    p.on("error", reject);
    p.on("close", (code) => { if (code !== 0) return reject(new AppError("The audio could not be decoded for captions.", { code: "AUDIO_DECODE_FAILED", status: 500 })); const b = Buffer.concat(chunks); resolve(new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4))); });
  });
}

type Asr = (audio: Float32Array, o: Record<string, unknown>) => Promise<{ chunks?: { text: string; timestamp: [number, number | null] }[] }>;
const g = globalThis as unknown as { __asr?: Promise<Asr> };

/** Word timings (seconds from `start`): local Whisper (@huggingface/transformers, optional), else OpenAI's API. */
export async function transcribe(file: string, start: number, duration: number, progress: (f: number) => void = () => {}, language: string = settings.whisperLanguage): Promise<Word[]> {
  let asr: Asr | null = null;
  try {
    g.__asr ??= (async () => {
      const mod = (await import(/* webpackIgnore: true */ "@huggingface/transformers" as string)) as { pipeline: (task: string, model: string) => Promise<Asr> };
      return mod.pipeline("automatic-speech-recognition", `onnx-community/whisper-${settings.whisperModel || "base"}`);
    })();
    asr = await g.__asr;
  } catch {
    g.__asr = undefined;
  }
  if (asr) {
    const samples = await decode16k(file, start, duration);
    const out = await asr(samples, { return_timestamps: "word", chunk_length_s: 30, ...(language ? { language } : {}) });
    progress(1);
    return (out.chunks ?? []).map((c) => ({ text: c.text.trim(), start: c.timestamp[0], end: c.timestamp[1] ?? c.timestamp[0] + 0.3 })).filter((w) => w.text);
  }
  if (settings.openaiApiKey) {
    const samples = await decode16k(file, start, duration);
    const wav = Buffer.alloc(44 + samples.length * 2);
    wav.write("RIFF", 0); wav.writeUInt32LE(36 + samples.length * 2, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(samples.length * 2, 40);
    samples.forEach((v, i) => wav.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), 44 + i * 2));
    const form = new FormData();
    form.append("file", new Blob([wav], { type: "audio/wav" }), "window.wav");
    form.append("model", "whisper-1");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    if (language) form.append("language", language);
    const r = await fetch(`${(settings.openaiBaseUrl || "https://api.openai.com/v1").replace(/\/+$/, "")}/audio/transcriptions`, { method: "POST", headers: { authorization: `Bearer ${settings.openaiApiKey}` }, body: form, signal: AbortSignal.timeout(300_000) });
    if (!r.ok) throw new CaptionsUnavailable(`Speech recognition failed (OpenAI ${r.status}).`);
    const body = await r.json() as { words?: { word: string; start: number; end: number }[] };
    progress(1);
    return (body.words ?? []).map((w) => ({ text: w.word.trim(), start: w.start, end: w.end })).filter((w) => w.text);
  }
  throw new CaptionsUnavailable("Captions need speech recognition: install the optional local Whisper package (npm install @huggingface/transformers in the project folder) or set OPENAI_API_KEY.");
}
