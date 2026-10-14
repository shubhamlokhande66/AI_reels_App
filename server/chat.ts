import "server-only";
import fs from "node:fs";
import { moveFile } from "@/server/storage/local";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { buildProvider, getProvider, type ManagedProvider } from "@/server/ai";
import { OllamaProvider } from "@/server/ai/providers";
import { analyzeAudio } from "@/server/audio/analyzer";
import { settings } from "@/server/core/config";
import { AIUnavailable, AppError, CorruptedMedia, PayloadTooLarge, UnsupportedMedia, ValidationFailed } from "@/server/core/errors";
import { findBinary, probe, run } from "@/server/core/ffmpeg";
import { buildMusicMap, LEVEL_ACTION, LEVEL_NAMES } from "@/server/director/musicMap";
import { AUDIO_EXTS, sanitizeFilename, VIDEO_EXTS } from "@/server/media/service";
import { parseVideoProbe } from "@/server/media/probe";
import { readUpload } from "@/server/media/upload";
import { listStyles } from "@/server/styles";
import { parseAiActions } from "@/server/revise/actions";

/** A free-form chat with the AI model (was api/chat.py): brainstorm, ask questions, get plain answers. Stateless (the
 * client sends the whole conversation) and never touches a project. Attachments are read for the moment it takes and
 * never saved: images go to a vision model, a video sends a few sampled frames, audio is described from the real beat
 * analysis, PDFs and text files are folded into the message. */

const MAX_TURNS = 40, MAX_MESSAGE_LEN = 20_000, MAX_IMAGES_PER_MESSAGE = 4, MAX_IMAGES_PER_REQUEST = 12, MAX_IMAGE_B64_CHARS = 8_000_000;
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024, MAX_VIDEO_BYTES = 200 * 1024 * 1024, MAX_AUDIO_BYTES = 50 * 1024 * 1024, MAX_FILE_TEXT_CHARS = 12_000, MAX_IMAGE_DIM = 1280, VIDEO_FRAMES = 3, MAX_BEAT_LINES = 15;
const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tif", ".tiff"];
const TEXT_EXTS = [".txt", ".md", ".markdown", ".rst", ".csv", ".tsv", ".json", ".jsonl", ".log", ".py", ".js", ".jsx", ".ts", ".tsx", ".html", ".htm", ".css", ".scss", ".yml", ".yaml", ".xml", ".sql", ".sh", ".bat", ".ps1", ".ini",
  ".toml", ".cfg", ".env", ".java", ".c", ".h", ".cpp", ".hpp", ".go", ".rb", ".php", ".rs", ".kt", ".swift"];
const SYSTEM = "You are a helpful assistant inside a Reel-editing app, for brainstorming ideas and answering questions in plain language: pacing, styles, captions, music choices, shot order, general editing advice. Answer directly and concisely (a few sentences, more only if truly needed). " +
  "The person may attach an image, video, audio file, PDF, or text/code file to a message — when they do, its content (or, for a video, a few sampled frames; for audio, real beat/tempo/energy analysis with actual timestamps) is included for you to actually use in your answer — never invent numbers beyond what was given. " +
  "Audio is not transcribed — you are never given spoken words or lyrics, or things like exact time signature or instrument type, so say so plainly if asked about audio content you were not given, rather than guessing. " +
  "You cannot generate, animate or synthesize any video, image or audio yourself, and you cannot see their actual project footage unless they attach it here. If asked to generate or animate something, say so plainly and, if it fits, suggest describing the change in the app's 'Change this Reel' box instead, which can apply real edits (trim, speed, order, transitions, captions, music, style) to their own uploaded clips.";

export const ChatRequest = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]), content: z.string().min(1).max(MAX_MESSAGE_LEN),
    images: z.array(z.string().max(MAX_IMAGE_B64_CHARS, "An attached image is too large.")).max(MAX_IMAGES_PER_MESSAGE, `At most ${MAX_IMAGES_PER_MESSAGE} images per message.`).default([]),
  })).min(1).max(MAX_TURNS),
}).refine((r) => r.messages.reduce((n, m) => n + m.images.length, 0) <= MAX_IMAGES_PER_REQUEST, `At most ${MAX_IMAGES_PER_REQUEST} images in one conversation turn.`);

async function supportsVision(p: ManagedProvider): Promise<boolean> {
  const prov = p.primary;
  if (!prov.isLocal && ["openai", "gemini", "claude"].includes(prov.name)) return Boolean(prov.visionModel || prov.model);
  if (!(prov instanceof OllamaProvider)) return false;
  try {
    const model = prov.visionModel || prov.model;
    const m = (await prov.installedModels()).find((x) => x.name === model || x.name.split(":")[0] === model);
    return Boolean(m?.capabilities.includes("vision"));
  } catch { return false; }
}
export async function chat(req: z.infer<typeof ChatRequest>) {
  if (req.messages[req.messages.length - 1].role !== "user") throw new ValidationFailed("The last message must be from you.", { code: "BAD_CHAT_TURN" });
  const provider = getProvider("chat");
  let health: { available?: boolean; detail?: string | null } = { available: false };
  try { health = await provider.health(); } catch { /* reported below */ }
  if (!health.available) {
    if (provider.isLocal) throw new AIUnavailable("The local AI model is not reachable. Check Settings → AI, or that Ollama is running.");
    throw new AIUnavailable(`The AI provider (${provider.name}) is not available: ${health.detail || "check Settings → AI"}.`);
  }
  if (req.messages.some((m) => m.images.length) && !(await supportsVision(provider))) throw new AIUnavailable("The current AI model can't see images. Pick a vision-capable model in Settings → AI.", { code: "AI_VISION_UNSUPPORTED" });
  return { reply: await provider.chatTurns(SYSTEM, req.messages.map((m) => ({ role: m.role, content: m.content, ...(m.images.length ? { images: m.images } : {}) }))) };
}

// ------------------------------------------------------------------ attachments
const spread = <T,>(items: T[], n: number): T[] => (items.length <= n || n <= 1 ? items : [...new Set(Array.from({ length: n }, (_, i) => Math.round((i * (items.length - 1)) / (n - 1))))].sort((a, b) => a - b).map((i) => items[i]));
function energyBuckets(curve: [number, number, string][], duration: number, n = 12): [number, number, string][] {
  if (!curve.length || duration <= 0) return [];
  const step = duration / n, out: [number, number, string][] = [];
  for (let i = 0; i < n; i++) {
    const a = i * step, b = i === n - 1 ? duration : (i + 1) * step, w = new Map<string, number>();
    for (const [rs, re, label] of curve) { const o = Math.min(re, b) - Math.max(rs, a); if (o > 0) w.set(label, (w.get(label) ?? 0) + o); }
    out.push([a, b, w.size ? [...w].reduce((m, x) => (x[1] > m[1] ? x : m))[0] : "medium"]);
  }
  return out;
}
async function readAudio(file: string, display: string): Promise<string> {
  const info = await probe(file);
  if (!(info.streams ?? []).some((s) => s.codec_type === "audio")) throw new UnsupportedMedia(`'${display}' has no audio stream.`);
  const duration = Number(info.format?.duration ?? 0);
  let audio;
  try { audio = await analyzeAudio(file); } catch (e) {
    if (e instanceof CorruptedMedia) return `Attached audio '${display}': duration ${duration.toFixed(1)}s. Beat analysis could not run on this file (it may be silent or too short); only its container metadata was read. Spoken words or lyrics are never transcribed.`;
    throw e;
  }
  const music = buildMusicMap(audio, 0, audio.duration), notable = music.beats.filter((b) => b.level >= 3), sample = spread(notable, MAX_BEAT_LINES);
  const lines = sample.map((b) => `  ${b.t.toFixed(2).padStart(6)}s - ${LEVEL_NAMES[b.level]} (${LEVEL_ACTION[b.level]})${b.downbeat ? " [downbeat]" : ""}`);
  const pct = music.beats.length ? Math.round((100 * notable.length) / music.beats.length) : 0;
  const parts = [
    `Attached audio '${display}': duration ${audio.duration.toFixed(1)}s, tempo ~${audio.bpm.toFixed(0)} BPM (beat-grid confidence ${audio.beatConfidence.toFixed(2)}). This is real signal analysis (the same beat/accent detection the app's Beat Sync feature uses to cut video on the beat), not a guess.`,
    `${notable.length} of ${music.beats.length} detected beats (${pct}%) are strong/major (edit-worthy)${notable.length > sample.length ? `. ${sample.length} examples spread across the whole track` : ""}${lines.length ? `:\n${lines.join("\n")}` : ". None stood out from the regular beat grid."}`,
  ];
  if (music.drops.length) { const shown = spread(music.drops, 15); parts.push(`Drops (sudden energy jumps)${shown.length < music.drops.length ? ` (${shown.length} of ${music.drops.length}, spread across the track)` : ""}: ${shown.map((d) => `${d.toFixed(2)}s`).join(", ")}`); }
  if (music.pauses.length) { const shown = spread(music.pauses, 10); parts.push(`Quiet/low-energy stretches${shown.length < music.pauses.length ? ` (${shown.length} of ${music.pauses.length}, spread across the track)` : ""}: ${shown.map(([a, b]) => `${a.toFixed(1)}-${b.toFixed(1)}s`).join(", ")}`); }
  const buckets = energyBuckets(music.energyCurve, audio.duration);
  if (buckets.length) parts.push(`Energy across the full track, in ${buckets.length} equal parts: ${buckets.map(([a, b, n]) => `${a.toFixed(1)}-${b.toFixed(1)}s ${n}`).join(", ")}`);
  parts.push("Not detected here (would need more than beat/energy analysis, so do not invent these if asked): time signature, instrument/drum type (kick/snare/clap/bass), vocals, lyrics. Spoken words or lyrics are never transcribed — there is no speech-to-text step in this analysis.");
  parts.push("Every number above came from analysing the real waveform and already covers the whole track — report only these, in your own words if useful, but do not derive, recompute or approximate additional figures from them (e.g. a 'beat interval' from the BPM, or a beat count from BPM × duration): the beat grid is not perfectly regular, so simple arithmetic on BPM will not match the real numbers above.");
  return parts.join("\n");
}
async function readVideo(file: string, display: string): Promise<[string, string[]]> {
  const meta = parseVideoProbe(await probe(file)), frames: string[] = [], tmp = fs.mkdtempSync(path.join(os.tmpdir(), "chat_"));
  try {
    for (let i = 0; i < VIDEO_FRAMES; i++) {
      const out = path.join(tmp, `f${i}.jpg`), t = (meta.duration * (i + 0.5)) / VIDEO_FRAMES;
      try { await run(findBinary("ffmpeg"), ["-hide_banner", "-loglevel", "error", "-y", "-ss", t.toFixed(3), "-i", file, "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4", out], 60_000); frames.push(fs.readFileSync(out).toString("base64")); } catch { /* unreadable spot */ }
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  if (!frames.length) throw new UnsupportedMedia(`No frames could be read from '${display}'.`);
  return [`Attached video '${display}': ${meta.duration.toFixed(1)}s, ${meta.width}x${meta.height}, ${meta.fps.toFixed(0)}fps. ${frames.length} frames sampled evenly through it are attached as images below (not the whole video).`, frames];
}
async function readPdf(raw: Buffer): Promise<[string, boolean]> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  let pages: string[];
  try {
    const pdf = await getDocumentProxy(new Uint8Array(raw));
    pages = (await extractText(pdf, { mergePages: false })).text as string[];
  } catch (e) {
    if (/password/i.test(String((e as Error).message))) throw new UnsupportedMedia("That PDF is password-protected. Remove the password and try again.");
    throw new UnsupportedMedia("That PDF could not be read (it may be corrupted).");
  }
  const text = pages.map((t, i) => [i, t.trim()] as const).filter(([, t]) => t).map(([i, t]) => `--- page ${i + 1} ---\n${t}`).join("\n\n").trim();
  if (!text) throw new UnsupportedMedia("No text was found in that PDF — it may be scanned pages/images rather than real text, which isn't read yet.");
  return text.length > MAX_FILE_TEXT_CHARS ? [text.slice(0, MAX_FILE_TEXT_CHARS), true] : [text, false];
}
export async function chatFile(req: Request) {
  const up = await readUpload(req, MAX_VIDEO_BYTES, 1);
  try {
    const f = up.files.find((x) => x.field === "file");
    if (!f) throw new ValidationFailed("Request validation failed.", { details: [{ loc: ["body", "file"], msg: "Field required" }] });
    const display = sanitizeFilename(f.filename, "attachment"), ext = path.extname(display).toLowerCase(), mb = (n: number) => Math.trunc(n / (1024 * 1024));
    const tooBig = (max: number) => { if (f.tooLarge || f.size > max) throw new PayloadTooLarge(`'${display}' is too large (max ${mb(max)}MB).`); };
    if (!f.size && !f.tooLarge) throw new ValidationFailed("The uploaded file is empty.", { code: "EMPTY_FILE" });
    const base = { name: display, sizeBytes: f.size, text: null as string | null, images: [] as string[], truncated: false };
    if (VIDEO_EXTS.includes(ext)) {
      tooBig(MAX_VIDEO_BYTES);
      const named = `${f.tmp}${ext}`; moveFile(f.tmp, named); f.tmp = named;
      const [text, images] = await readVideo(named, display);
      return { ...base, kind: "video", mime: f.mimeType || "video/mp4", text, images };
    }
    if (AUDIO_EXTS.includes(ext)) {
      tooBig(MAX_AUDIO_BYTES);
      const named = `${f.tmp}${ext}`; moveFile(f.tmp, named); f.tmp = named;
      return { ...base, kind: "audio", mime: f.mimeType || "audio/mpeg", text: await readAudio(named, display) };
    }
    tooBig(MAX_UPLOAD_BYTES);
    const raw = fs.readFileSync(f.tmp);
    if (IMAGE_EXTS.includes(ext)) {
      let jpg: Buffer;
      try { jpg = await sharp(raw).rotate().resize(MAX_IMAGE_DIM, MAX_IMAGE_DIM, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer(); } catch { throw new UnsupportedMedia("That file is not a readable image."); }
      return { ...base, kind: "image", mime: f.mimeType || "image/jpeg", images: [jpg.toString("base64")] };
    }
    if (ext === ".pdf") { const [text, truncated] = await readPdf(raw); return { ...base, kind: "text", mime: "application/pdf", text, truncated }; }
    if (TEXT_EXTS.includes(ext) || ext === "") {
      const text = raw.toString("utf8");
      return { ...base, kind: "text", mime: f.mimeType || "text/plain", text: text.slice(0, MAX_FILE_TEXT_CHARS), truncated: text.length > MAX_FILE_TEXT_CHARS };
    }
    throw new UnsupportedMedia(`'${ext}' files aren't supported yet. You can attach images, videos, audio, PDFs, and text/code files.`, { details: { allowed: [...new Set([...IMAGE_EXTS, ...TEXT_EXTS, ...VIDEO_EXTS, ...AUDIO_EXTS, ".pdf"])].sort() } });
  } finally { up.cleanup(); }
}

// ------------------------------------------------------------------ the Ollama model test (api/ai_settings.py)
const TEST_REQUEST = "make the music louder and slow down the last shot", EXPECTED = ["music_volume", "speed"];
export async function testModel(model: string) {
  const base = buildProvider("ollama") as OllamaProvider;
  const installed = new Set((await base.installedModels()).map((m) => m.name));
  if (!installed.has(model)) throw new ValidationFailed(`'${model}' is not installed in Ollama.`, { code: "MODEL_NOT_INSTALLED" });
  const provider = new OllamaProvider(settings.ollamaBaseUrl, model, settings.aiTimeoutSeconds), styles = listStyles().map((s) => s.id).sort();
  const user = JSON.stringify({ request: TEST_REQUEST, reel: { shots: [1, 2, 3, 4].map((i) => ({ n: i, clip: `clip${i}.mp4`, seconds: 3.0, speed: 1.0, effect: "none", transition: "cut" })), duration: 12, style: "cinematic", pace: "balanced", captions: false, has_voice: false }, styles });
  const t = performance.now();
  let data: Record<string, unknown>;
  try {
    const { revisionSystemPrompt } = await import("@/server/revise/actions");
    const res = await provider.generate({ system: revisionSystemPrompt(), user, jsonMode: true, task: "revision" });
    data = res.parsed ?? (JSON.parse(res.text) as Record<string, unknown>);
  } catch (e) {
    return { model, ok: false, seconds: Math.round((performance.now() - t) / 100) / 10, verdict: "failed", detail: String(e instanceof AppError ? e.message : (e as Error).message).slice(0, 200) };
  }
  const seconds = Math.round((performance.now() - t) / 100) / 10, [acts] = parseAiActions(data, 4, new Set(styles), TEST_REQUEST), got = [...new Set(acts.map((a) => a.kind))].sort();
  let verdict: string, detail: string;
  if (got.length === EXPECTED.length && EXPECTED.every((k) => got.includes(k))) [verdict, detail] = ["correct", "Understood the request exactly."];
  else if (EXPECTED.every((k) => got.includes(k))) [verdict, detail] = ["over-eager", `Understood it but also added actions you did not ask for: ${got.filter((k) => !EXPECTED.includes(k)).join(", ")}.`];
  else if (got.length) [verdict, detail] = ["wrong", `Returned ${got.join(", ")} instead of the two requested changes.`];
  else [verdict, detail] = ["wrong", "Returned no usable actions."];
  return { model, ok: verdict === "correct", seconds, verdict, detail };
}
