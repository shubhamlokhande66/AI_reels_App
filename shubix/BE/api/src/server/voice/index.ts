import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { settings } from "../core/config";
import { db, parseId } from "../core/db";
import { AppError, NotFoundError, ValidationFailed } from "../core/errors";
import { probe, renderFfmpeg } from "../core/ffmpeg";
import { round } from "@shubix/core/engine/core/py";

/** Voices and voice-over (were voice/*.py, ai/script.py, api/voice.py): offline Windows voices (SAPI) and natural AI
 * voices (Gemini, OpenAI) behind one list, scripts the AI writes and the person edits, and the voice-over that re-times
 * the Reel to the real voice. */

export class VoiceUnavailable extends AppError { constructor(message: string, code = "VOICE_UNAVAILABLE", details: unknown = null) { super(message, { code, status: 503, details }); } }
export interface VoiceInfo { id: string; name: string; language: string; gender: string; provider: string }

// ------------------------------------------------------------------ prosody and SSML (voice/base.py)
export const EMOTIONS: Record<string, [number, number, number]> = { neutral: [1, 0, 90], friendly: [1.03, 4, 92], energetic: [1.12, 8, 100], calm: [0.92, -3, 82], serious: [0.95, -6, 90] };
export const ENERGY: Record<string, [number, number]> = { low: [0.95, -3], medium: [1, 0], high: [1.06, 6] };
export const PAUSES: Record<string, number> = { tight: 0.18, natural: 0.42, dramatic: 0.85 };
export interface SpeechSettings { speed: number; pitch: number; energy: string; emotion: string; pauseStyle: string; pronunciations: Record<string, string> }
export const speech = (p: Partial<SpeechSettings> = {}): SpeechSettings => ({ speed: 1, pitch: 0, energy: "medium", emotion: "neutral", pauseStyle: "natural", pronunciations: {}, ...p });
export function prosody(s: SpeechSettings): [number, number, number] {
  const [es, ep, ev] = EMOTIONS[s.emotion] ?? EMOTIONS.neutral, [ns, nv] = ENERGY[s.energy] ?? ENERGY.medium;
  return [Math.min(Math.max(s.speed * es * ns, 0.5), 2), Math.min(Math.max(s.pitch + ep, -30), 30), Math.min(Math.max(ev + nv, 0), 100)];
}
const pauseSeconds = (s: SpeechSettings) => PAUSES[s.pauseStyle] ?? PAUSES.natural;
const xml = (t: string, quote = false) => { const out = t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); return quote ? out.replace(/"/g, "&quot;") : out; };
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function applyPronunciations(text: string, table: Record<string, string>) {
  let out = xml(text);
  for (const [word, alias] of Object.entries(table)) {
    if (!word.trim() || !alias.trim()) continue;
    out = out.replace(new RegExp(`(?<!\\w)${reEsc(xml(word))}(?!\\w)`, "gi"), (m) => `<sub alias="${xml(alias, true)}">${m}</sub>`);
  }
  return out;
}
export function buildSsml(text: string, s: SpeechSettings, language = "en-US") {
  const [speed, pitch, volume] = prosody(s), sign = (v: number) => (v >= 0 ? "+" : "-") + String(Math.abs(round(v)));
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${xml(language)}"><prosody rate="${sign((speed - 1) * 100)}%" pitch="${sign(pitch)}%" volume="${volume}">${applyPronunciations(text, s.pronunciations)}</prosody></speak>`;
}
const unxml = (t: string) => t.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/** (spoken text, speed multiplier, pitch percent) from the app's SSML. */
export function ssmlToText(ssml: string): [string, number, number] {
  let text = ssml.replace(/<sub alias="([^"]*)">[^<]*<\/sub>/g, (_, a: string) => unxml(a));
  const rate = /rate="([+-]?\d+(?:\.\d+)?)%"/.exec(ssml), pitch = /pitch="([+-]?\d+(?:\.\d+)?)%"/.exec(ssml);
  text = unxml(text.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  return [text, rate ? 1 + Number(rate[1]) / 100 : 1, pitch ? Number(pitch[1]) : 0];
}

// ------------------------------------------------------------------ engines
interface Engine { name: string; prefix: string; available(): boolean; listVoices(): Promise<VoiceInfo[]>; findVoice(language: string, preferred?: string | null): Promise<VoiceInfo>; synthesize(ssml: string, voiceId: string, out: string): Promise<void> }

const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
const RATE_LIMIT_TRIES = 4, MAX_WAIT = 60;
function pcmToWav(data: Buffer, rate = 24000): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const SAPI_SCRIPT = path.join(process.cwd(), "src", "server", "voice", "sapi_speak.ps1");
class Sapi implements Engine {
  name = "sapi"; prefix = "";
  private voices: VoiceInfo[] | null = null;
  available() { return process.platform === "win32" && fs.existsSync(SAPI_SCRIPT); }
  private run(args: string[], timeout = 120): Promise<string> {
    return new Promise((resolve, reject) => execFile("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SAPI_SCRIPT, ...args], { timeout: timeout * 1000, windowsHide: true, maxBuffer: 8 << 20 },
      (err, stdout, stderr) => (err ? reject(new VoiceUnavailable(err.killed ? "The voice engine took too long to respond." : "The voice engine failed.", "VOICE_UNAVAILABLE", String(stderr || stdout).slice(-400))) : resolve(String(stdout)))));
  }
  async listVoices() {
    if (this.voices) return this.voices;
    if (!this.available()) return [];
    try {
      const data = JSON.parse((await this.run(["-List"], 30)) || "[]");
      this.voices = (Array.isArray(data) ? data : [data]).map((v: Record<string, string>) => ({ id: v.name, name: v.name, language: v.culture ?? "", gender: v.gender ?? "", provider: this.name }));
    } catch { return []; }
    return this.voices!;
  }
  async findVoice(language: string, preferred: string | null = null) {
    const voices = await this.listVoices(), lang = (language.toLowerCase() === "hinglish" ? "en" : language.toLowerCase()).split("-")[0];
    if (preferred) { const v = voices.find((x) => x.id === preferred || x.name === preferred); if (v && v.language.toLowerCase().startsWith(lang)) return v; }
    const v = voices.find((x) => x.language.toLowerCase().startsWith(lang));
    if (v) return v;
    throw new AppError(`No installed voice can speak '${language}'. Installed voices: ${voices.map((x) => `${x.name} (${x.language})`).join(", ") || "none"}. Install a voice pack for that language (or add another voice engine).`,
      { code: "VOICE_LANGUAGE_UNAVAILABLE", status: 422, details: { language, installed: voices.map((x) => x.id) } });
  }
  async synthesize(ssml: string, voiceId: string, out: string) {
    if (!(await this.listVoices()).some((v) => v.id === voiceId)) throw new VoiceUnavailable(`The voice '${voiceId.slice(0, 60)}' is not installed.`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "reel_tts_")), f = path.join(tmp, "line.ssml");
    try {
      fs.writeFileSync(f, ssml, "utf8");
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await this.run(["-SsmlFile", f, "-OutFile", path.resolve(out), "-Voice", voiceId]);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    if (!fs.existsSync(out) || fs.statSync(out).size < 100) throw new VoiceUnavailable("The voice engine produced no audio.");
  }
}

const GEMINI_VOICES: [string, string, string][] = [["Kore", "firm", "female"], ["Aoede", "breezy", "female"], ["Leda", "youthful", "female"], ["Zephyr", "bright", "female"], ["Autonoe", "bright", "female"],
  ["Callirrhoe", "easy-going", "female"], ["Despina", "smooth", "female"], ["Puck", "upbeat", "male"], ["Charon", "informative", "male"], ["Fenrir", "excitable", "male"], ["Orus", "firm", "male"],
  ["Enceladus", "breathy", "male"], ["Iapetus", "clear", "male"], ["Algenib", "gravelly", "male"]];
class GeminiVoice implements Engine {
  name = "gemini"; prefix = "gemini:";
  available() { return Boolean(settings.geminiApiKey); }
  async listVoices() { return this.available() ? GEMINI_VOICES.map(([n, c, g]) => ({ id: `${this.prefix}${n}`, name: `${n} · ${c} (AI, any language)`, language: "multi", gender: g, provider: this.name })) : []; }
  async findVoice(_l: string, preferred: string | null = null) {
    const v = await this.listVoices();
    if (!v.length) throw new VoiceUnavailable("Natural AI voices need a Gemini API key.");
    return v.find((x) => preferred && [x.id, x.name].includes(preferred)) ?? v[0];
  }
  async synthesize(ssml: string, voiceId: string, out: string) {
    const name = voiceId.replace(this.prefix, "");
    if (!GEMINI_VOICES.some(([n]) => n === name)) throw new VoiceUnavailable(`The voice '${voiceId.slice(0, 60)}' does not exist.`);
    const [text, speed, pitch] = ssmlToText(ssml);
    if (!text) throw new VoiceUnavailable("Nothing to say on this line.");
    const parts = [speed >= 1.08 ? "a little faster, with energy" : speed <= 0.94 ? "calmly and a little slower" : "", pitch >= 5 ? "brightly" : pitch <= -5 ? "in a lower, serious tone" : ""].filter(Boolean);
    const body = { contents: [{ parts: [{ text: (parts.length ? `Say ${parts.join(", ")}: ` : "") + text }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: name } } } } };
    let r: Response | null = null;
    for (let attempt = 0; attempt < RATE_LIMIT_TRIES; attempt++) {
      try { r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${settings.geminiTtsModel}:generateContent`, { method: "POST", headers: { "x-goog-api-key": settings.geminiApiKey, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) }); }
      catch { throw new VoiceUnavailable("The AI voice service could not be reached."); }
      if (r.status !== 429 || attempt === RATE_LIMIT_TRIES - 1) break;
      let wait = 20, daily = false;
      try { for (const d of ((await r.clone().json()).error?.details ?? []) as Record<string, unknown>[]) { if (String(d["@type"]).endsWith("RetryInfo") && d.retryDelay) wait = parseFloat(String(d.retryDelay)); for (const v of (d.violations as { quotaId?: string }[]) ?? []) if (String(v.quotaId).includes("PerDay")) daily = true; } } catch { /* not JSON */ }
      if (daily || wait > MAX_WAIT) throw new VoiceUnavailable("Today's free AI voice limit is used up (the free Gemini tier allows only a few voice requests a day). It resets tomorrow; with billing on the Gemini key there is no daily limit.", "VOICE_DAILY_LIMIT");
      await sleep(Math.min(wait + 1, MAX_WAIT));
    }
    if (r!.status === 429) throw new VoiceUnavailable("The AI voice service is busy (too many requests). Try again in a minute.", "VOICE_RATE_LIMITED");
    if (r!.status !== 200) throw new VoiceUnavailable(`The AI voice service refused the request (${r!.status}).`, "VOICE_UNAVAILABLE", (await r!.text()).slice(-300));
    let audio: Buffer;
    try {
      const part = (await r!.json()).candidates[0].content.parts[0].inlineData, data = Buffer.from(part.data, "base64");
      audio = data.subarray(0, 4).toString() === "RIFF" ? data : pcmToWav(data, Number(/rate=(\d+)/.exec(part.mimeType ?? "")?.[1] ?? 24000));
    } catch { throw new VoiceUnavailable("The AI voice service returned no audio."); }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, audio);
  }
}

const OPENAI_VOICES: [string, string, string][] = [["onyx", "deep", "male"], ["ash", "warm", "male"], ["echo", "calm", "male"], ["ballad", "storyteller", "male"], ["verse", "expressive", "male"], ["fable", "narrator", "male"],
  ["alloy", "neutral", "female"], ["coral", "bright", "female"], ["nova", "friendly", "female"], ["sage", "soft", "female"], ["shimmer", "clear", "female"]];
class OpenAIVoice implements Engine {
  name = "openai"; prefix = "openai:";
  available() { return Boolean(settings.openaiApiKey); }
  async listVoices() { return this.available() ? OPENAI_VOICES.map(([n, c, g]) => ({ id: `${this.prefix}${n}`, name: `${n[0].toUpperCase()}${n.slice(1)} · ${c} (OpenAI, any language)`, language: "multi", gender: g, provider: this.name })) : []; }
  async findVoice(_l: string, preferred: string | null = null) {
    const v = await this.listVoices();
    if (!v.length) throw new VoiceUnavailable("OpenAI voices need an OpenAI API key.");
    return v.find((x) => preferred && [x.id, x.name].includes(preferred)) ?? v[0];
  }
  private async request(text: string, voice: string, how: string): Promise<Buffer> {
    const body: Record<string, unknown> = { model: settings.openaiTtsModel, voice, input: text, response_format: "wav" };
    if (!settings.openaiTtsModel.includes("tts-1")) body.instructions = how;
    for (let attempt = 0; attempt < RATE_LIMIT_TRIES; attempt++) {
      let r: Response;
      try { r = await fetch("https://api.openai.com/v1/audio/speech", { method: "POST", headers: { authorization: `Bearer ${settings.openaiApiKey}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(180_000) }); }
      catch { throw new VoiceUnavailable("The OpenAI voice service could not be reached."); }
      if (r.status === 429) {
        let err: { code?: string; type?: string } = {};
        try { err = (await r.clone().json()).error ?? {}; } catch { /* not JSON */ }
        if (err.code === "insufficient_quota" || err.type === "insufficient_quota") throw new VoiceUnavailable("The OpenAI account has no credit left. Add credit on platform.openai.com, then try again.", "VOICE_DAILY_LIMIT");
        if (attempt < RATE_LIMIT_TRIES - 1) { await sleep(Math.min(Number(r.headers.get("retry-after") || 5) + 1, MAX_WAIT)); continue; }
        throw new VoiceUnavailable("The OpenAI voice service is busy. Try again in a minute.", "VOICE_RATE_LIMITED");
      }
      if (r.status === 401) throw new VoiceUnavailable("The OpenAI API key was refused. Check OPENAI_API_KEY.", "VOICE_KEY_INVALID");
      if (r.status !== 200) throw new VoiceUnavailable(`The OpenAI voice service refused the request (${r.status}).`, "VOICE_UNAVAILABLE", (await r.text()).slice(-300));
      return Buffer.from(await r.arrayBuffer());
    }
    throw new VoiceUnavailable("The OpenAI voice service is busy. Try again in a minute.", "VOICE_RATE_LIMITED");
  }
  async synthesize(ssml: string, voiceId: string, out: string) {
    const name = voiceId.replace(this.prefix, "");
    if (!OPENAI_VOICES.some(([n]) => n === name)) throw new VoiceUnavailable(`The voice '${voiceId.slice(0, 60)}' does not exist.`);
    const [text, speed, pitch] = ssmlToText(ssml);
    if (!text) throw new VoiceUnavailable("Nothing to say on this line.");
    const how = ["Speak naturally, like a warm storyteller, with clear pronunciation of Indian names and words", ...(speed >= 1.08 ? ["a little faster, with energy"] : speed <= 0.94 ? ["calmly and a little slower, with short dramatic pauses between sentences"] : []),
      ...(pitch <= -5 ? ["in a lower, serious tone"] : pitch >= 5 ? ["brightly"] : [])].join(", ") + ".";
    const parts: string[] = [];
    let cur = "";
    for (const para of text.replace(/।/g, "। ").split("\n")) { if (cur.length + para.length + 1 > 4096 && cur) { parts.push(cur); cur = ""; } cur = `${cur}\n${para}`.trim(); }
    if (cur) parts.push(cur);
    const wavs = [];
    for (const p of parts) wavs.push(await this.request(p.slice(0, 4096), name, how));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    if (wavs.length === 1) { fs.writeFileSync(out, wavs[0]); return; }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "reel_tts_"));
    try {
      const files = wavs.map((w, i) => { const f = path.join(tmp, `p${i}.wav`); fs.writeFileSync(f, w); return f; });
      await renderFfmpeg([...files.flatMap((f) => ["-i", f]), "-filter_complex", files.map((_, i) => `[${i}:a]`).join("") + `concat=n=${files.length}:v=0:a=1[out]`, "-map", "[out]", "-ac", "1", out], { timeout: 120 });
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
}

/** Natural AI voices first, then this computer's voices; each line goes to its engine by the voice id's prefix. */
class Combined {
  name = "combined";
  constructor(private local: Engine, private ais: Engine[]) {}
  private engine(id: string) { return this.ais.find((p) => id.startsWith(p.prefix)) ?? this.local; }
  available() { return this.ais.some((p) => p.available()) || this.local.available(); }
  async listVoices() { return [...(await Promise.all(this.ais.map((p) => p.listVoices()))).flat(), ...(await this.local.listVoices())]; }
  async findVoice(language: string, preferred: string | null = null): Promise<VoiceInfo> {
    if (preferred && this.engine(preferred) !== this.local) return this.engine(preferred).findVoice(language, preferred);
    try { return await this.local.findVoice(language, preferred); }
    catch (e) { for (const p of this.ais) if (p.available()) return p.findVoice(language, preferred); throw e; }
  }
  synthesize(ssml: string, voiceId: string, out: string) { return this.engine(voiceId).synthesize(ssml, voiceId, out); }
}
const gv = globalThis as unknown as { __voices?: Combined };
export const voiceProvider = () => (gv.__voices ??= new Combined(new Sapi(), [new GeminiVoice(), new OpenAIVoice()]));

// ------------------------------------------------------------------ script -> voice (voice/service.py)
const MAX_LINES_V = 40, MAX_LINE_CHARS_V = 400, WORDS_PER_MINUTE = 150;
export interface ScriptLine { text: string; pauseAfter: number | null }
export function estimateSeconds(lines: ScriptLine[], s: SpeechSettings = speech()) {
  const words = lines.reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0), pauses = lines.slice(0, -1).reduce((p, l) => p + (l.pauseAfter ?? pauseSeconds(s)), 0);
  return round((words / (WORDS_PER_MINUTE * prosody(s)[0])) * 60 + pauses, 2);
}
export function validateLines(lines: ScriptLine[]): ScriptLine[] {
  const out = lines.filter((l) => l.text?.trim()).map((l) => ({ text: l.text.trim(), pauseAfter: l.pauseAfter }));
  if (!out.length) throw new ValidationFailed("The script is empty.", { code: "EMPTY_SCRIPT" });
  if (out.length > MAX_LINES_V || out.some((l) => l.text.length > MAX_LINE_CHARS_V)) throw new ValidationFailed(`A script can have at most ${MAX_LINES_V} lines of ${MAX_LINE_CHARS_V} characters.`, { code: "SCRIPT_TOO_LONG" });
  return out;
}
/** One WAV for the whole script; every line spoken separately so pauses and timings are exact. */
export async function synthesizeScript(linesIn: ScriptLine[], voiceId: string, s: SpeechSettings, languageTag: string, out: string) {
  const lines = validateLines(linesIn), p = voiceProvider(), tmp = fs.mkdtempSync(path.join(os.tmpdir(), "reel_voice_"));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  try {
    const wavs: string[] = [], durations: number[] = [];
    for (const [i, l] of lines.entries()) {
      const wav = path.join(tmp, `l${String(i).padStart(2, "0")}.wav`);
      await p.synthesize(buildSsml(l.text, s, languageTag), voiceId, wav);
      durations.push(Number((await probe(wav)).format?.duration ?? 0));
      wavs.push(wav);
    }
    const pauses = lines.map((l, i) => (i < lines.length - 1 ? l.pauseAfter ?? pauseSeconds(s) : 0));
    const args: string[] = [], parts: string[] = [];
    let n = 0;
    wavs.forEach((w, i) => {
      args.push("-i", w); parts.push(`[${n}:a]aformat=sample_rates=24000:channel_layouts=mono[p${n}]`); n++;
      if (pauses[i] > 0) { args.push("-f", "lavfi", "-t", pauses[i].toFixed(3), "-i", "anullsrc=r=24000:cl=mono"); parts.push(`[${n}:a]aformat=sample_rates=24000:channel_layouts=mono[p${n}]`); n++; }
    });
    await renderFfmpeg([...args, "-filter_complex", parts.join(";") + ";" + Array.from({ length: n }, (_, i) => `[p${i}]`).join("") + `concat=n=${n}:v=0:a=1[out]`, "-map", "[out]", "-c:a", "pcm_s16le", out], { timeout: 120, errorCode: "VOICE_ASSEMBLY_FAILED" });
    let t = 0;
    const timeline = lines.map((l, i) => { const row = { text: l.text, start: round(t, 3), end: round(t + durations[i], 3) }; t += durations[i] + pauses[i]; return row; });
    return { path: out, duration: round(Number((await probe(out)).format?.duration ?? 0), 3), lines: timeline };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
// ------------------------------------------------------------------ voice profiles (api/voice.py)
const LANGUAGE_TAGS: Record<string, string> = { en: "en-US", hi: "hi-IN", mr: "mr-IN", hinglish: "en-US" };
const SAMPLE: Record<string, string> = { en: "Your everyday look just got a little more elegant.", hi: "आपका रोज़ का लुक अब और भी खूबसूरत।", mr: "तुमचा रोजचा लुक आता आणखी सुंदर.", hinglish: "Aapka everyday look ab aur bhi elegant." };
export const VoiceProfileIn = z.object({
  name: z.string().min(1).max(60), voice: z.string().max(120).nullable().default(null), language: z.enum(["en", "hi", "mr", "hinglish"]).default("en"), speed: z.number().min(0.5).max(2).default(1),
  pitch: z.number().min(-30).max(30).default(0), energy: z.enum(["low", "medium", "high"]).default("medium"), emotion: z.enum(["neutral", "friendly", "energetic", "calm", "serious"]).default("friendly"),
  pauseStyle: z.enum(["tight", "natural", "dramatic"]).default("natural"), pronunciations: z.record(z.string(), z.string()).default({}),
});
const PROFILE_KEYS = ["name", "voice", "language", "speed", "pitch", "energy", "emotion", "pauseStyle", "pronunciations"];
const profileOut = (d: Record<string, unknown>) => ({ id: String(d._id), ...Object.fromEntries(PROFILE_KEYS.map((k) => [k, d[k] ?? null])), createdAt: d.createdAt ?? null });
const settingsOf = (p: Record<string, unknown>) => speech({ speed: (p.speed as number) ?? 1, pitch: (p.pitch as number) ?? 0, energy: (p.energy as string) ?? "medium", emotion: (p.emotion as string) ?? "friendly", pauseStyle: (p.pauseStyle as string) ?? "natural", pronunciations: (p.pronunciations as Record<string, string>) ?? {} });
const voices = async () => (await db()).collection("voices");

export async function systemVoices() {
  const p = voiceProvider(), list = await p.listVoices(), langs = new Set(list.map((v) => v.language.split("-")[0]));
  const covered = { en: langs.has("en") || langs.has("multi"), hi: langs.has("hi") || langs.has("multi"), mr: langs.has("mr") || langs.has("multi"), hinglish: langs.has("en") || langs.has("multi") };
  return { provider: p.name, available: list.length > 0, voices: list, languages: covered, emotions: Object.keys(EMOTIONS), energies: Object.keys(ENERGY), pauseStyles: Object.keys(PAUSES),
    note: Object.values(covered).every(Boolean) ? null : "Some languages have no installed voice. Install a Windows voice pack (Settings > Time & language > Speech) or add another voice engine." };
}
export const listProfiles = async () => (await (await voices()).find({}).sort({ createdAt: -1 }).toArray()).map(profileOut);
export async function createProfile(p: z.infer<typeof VoiceProfileIn>) { const doc = { _id: new ObjectId(), ...p, createdAt: new Date() }; await (await voices()).insertOne(doc); return profileOut(doc); }
export async function updateProfile(id: string, p: z.infer<typeof VoiceProfileIn>) {
  const oid = parseId(id, "Voice"), col = await voices();
  if (!(await col.findOne({ _id: oid }))) throw new NotFoundError("Voice profile not found.", { code: "VOICE_NOT_FOUND" });
  await col.updateOne({ _id: oid }, { $set: p });
  return profileOut((await col.findOne({ _id: oid }))!);
}
export const deleteProfile = async (id: string) => { await (await voices()).deleteOne({ _id: parseId(id, "Voice") }); };
export async function previewProfile(id: string, text: string | null): Promise<Buffer> {
  const p = await (await voices()).findOne({ _id: parseId(id, "Voice") });
  if (!p) throw new NotFoundError("Voice profile not found.", { code: "VOICE_NOT_FOUND" });
  const voice = await voiceProvider().findVoice(p.language as string, p.voice as string | null);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "reel_prev_")), out = path.join(tmp, "preview.wav");
  try { await synthesizeScript([{ text: (text || SAMPLE[p.language as string]).trim(), pauseAfter: null }], voice.id, settingsOf(p), LANGUAGE_TAGS[p.language as string], out); return fs.readFileSync(out); }
  finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
