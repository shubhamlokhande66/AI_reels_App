import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ObjectId } from "mongodb";
import sharp from "sharp";
import { getProvider } from "@/server/ai";
import { charge } from "@/server/credits";
import { settings as cfg } from "@/server/core/config";
import { db } from "@/server/core/db";
import { AppError, NotFoundError, ValidationFailed } from "@/server/core/errors";
import { probe, renderFfmpeg } from "@/server/core/ffmpeg";
import { newResult, type PipelineInput, type PipelineResult, type StageProgress } from "@/server/jobs/pipeline";
import { projectKey } from "@/server/media/service";
import { localPath } from "@/server/storage/local";
import { buildSsml, speech, voiceProvider } from "@/server/voice";
import { getProductStyle, type CameraMove, type ProductReelPlan, type ProductStyle, type Shot, type TextLayer, type View } from "@/server/product/director";
import { FINAL, PREVIEW, renderReel } from "@/server/product/render";

/** Story -> Reel (were story/*.py and api/story.py): plan a story into scenes, give each scene a picture (cheapest source
 * first, or the person's own), narrate and render with the photo-Reel renderer. */

type Doc = Record<string, unknown>;
// ------------------------------------------------------------------ models
export interface ArtStyle { id: string; name: string; prompt: string; paintings: boolean }
export const ART_STYLES: Record<string, ArtStyle> = Object.fromEntries(([
  ["ravi_varma", "Classical Indian painting", "classical Indian oil painting in the style of Raja Ravi Varma, rich deep colours, soft golden light, fine detail", true],
  ["temple_mural", "Temple mural", "traditional Kerala temple mural painting, ornate, earthy reds and greens, bold outlines, divine and decorative", false],
  ["cinematic", "Cinematic realistic", "cinematic realistic film still, dramatic lighting, epic scale, shallow depth of field, rich colour grade", false],
  ["comic", "Indian comic book", "classic Indian comic book illustration, clean ink lines, flat bright colours, expressive faces", false],
  ["anime", "Anime", "detailed anime illustration, vibrant colours, soft cel shading, beautiful background art", false],
  ["watercolor", "Storybook watercolour", "soft storybook watercolour illustration, gentle colours, paper texture, warm and calm", false],
] as const).map(([id, name, prompt, paintings]) => [id, { id, name, prompt, paintings }]));
export interface Character { name: string; look: string }
export interface StoryScene { id: string; narration: string; visual: string; keywords: string[]; characters: string[]; shot: "wide" | "medium" | "close"; mood: string; image_key: string | null; source: string | null; credit: string; library_id: string | null; seen: string[] }
export interface StoryPlan { title: string; language: string; art_style: string; music_mood: string; characters: Character[]; scenes: StoryScene[]; post_copy: Record<string, unknown> | null; planned_by: string; source_text: string; seconds: number }
const newScene = (o: Partial<StoryScene> & Pick<StoryScene, "narration" | "visual">): StoryScene => ({ id: crypto.randomUUID().replace(/-/g, "").slice(0, 10), keywords: [], characters: [], shot: "medium", mood: "calm", image_key: null, source: null, credit: "", library_id: null, seen: [], ...o });
function planOf(raw: Doc): StoryPlan {
  return { title: String(raw.title ?? ""), language: String(raw.language ?? "hi"), art_style: String(raw.art_style ?? "ravi_varma"), music_mood: String(raw.music_mood ?? "devotional"),
    characters: (raw.characters as Character[]) ?? [], scenes: ((raw.scenes as Doc[]) ?? []).map((s) => newScene({ ...(s as Partial<StoryScene>), narration: String(s.narration ?? ""), visual: String(s.visual ?? "") })),
    post_copy: (raw.post_copy as Doc) ?? null, planned_by: String(raw.planned_by ?? "ai"), source_text: String(raw.source_text ?? ""), seconds: Number(raw.seconds ?? 60) };
}

// ------------------------------------------------------------------ planner
export const MIN_SCENES = 3, MAX_SCENES = 14;
const LANG_NAMES: Record<string, string> = { hi: "Hindi", en: "English", mr: "Marathi", hinglish: "Hinglish (Hindi in Latin letters)" };
const MOODS = ["calm", "devotional", "joyful", "tense", "sad", "epic", "mysterious"];
const SYSTEM = "You are a film director turning a story into a vertical short video (Instagram Reel) told with one picture per\nscene and a narrator's voice. Reply with JSON only.";
const prompt = (story: string, seconds: number, scenes: number, language: string) => `Story:
<<<
${story}
>>>
Make a plan for a ${seconds}-second Reel with ${scenes} scenes (fewer if the story is short).
Rules:
- Scene 1 is a hook: the most gripping moment or question of the story, told so a viewer keeps watching.
- narration: what the narrator says in ${language}, 8-25 words per scene, natural and spoken, in story order after the hook.
  Keep names and Sanskrit words correct. The last scene ends the story with a feeling or a lesson.
- visual: what the single picture shows, in English, one or two sentences: who, doing what, where, light and mood. Describe
  people by their character name. No text or letters in the picture.
- characters: every recurring person once, with a fixed visual description in English (age, skin, hair, clothing, ornaments,
  weapon or symbol) so every picture shows them the same. Respectful, traditional depictions for deities and epic heroes.
- keywords: 2-5 English words for searching a matching painting (names first, e.g. "Krishna", "Arjuna", "chariot").
- shot: wide | medium | close. mood: calm | devotional | joyful | tense | sad | epic | mysterious.
- post: a short title, a one-line description and 5-8 hashtags for posting.
JSON shape:
{"title": "...", "music_mood": "devotional", "characters": [{"name": "...", "look": "..."}],
  "scenes": [{"narration": "...", "visual": "...", "characters": ["..."], "keywords": ["..."], "shot": "wide", "mood": "epic"}],
  "post": {"title": "...", "description": "...", "hashtags": ["#..."]}}`;
const cl = (s: unknown, limit: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
function fromAi(data: Doc, language: string, artStyle: string, fallbackTitle: string): StoryPlan {
  const characters = ((data.characters as Doc[]) ?? []).filter((c) => c && typeof c === "object" && cl(c.name, 60)).map((c) => ({ name: cl(c.name, 60), look: cl(c.look, 300) })).slice(0, 8);
  const names = new Set(characters.map((c) => c.name));
  const scenes = ((data.scenes as Doc[]) ?? []).filter((d) => d && typeof d === "object").map((d) => {
    const narration = cl(d.narration, 600), visual = cl(d.visual, 700);
    if (!narration || !visual) return null;
    return newScene({ narration, visual, characters: ((d.characters as unknown[]) ?? []).map((x) => cl(x, 60)).filter((c) => names.has(c)), keywords: ((d.keywords as unknown[]) ?? []).map((x) => cl(x, 40)).filter(Boolean).slice(0, 5),
      shot: ["wide", "medium", "close"].includes(d.shot as string) ? (d.shot as StoryScene["shot"]) : "medium", mood: MOODS.includes(d.mood as string) ? (d.mood as string) : "calm" });
  }).filter((s): s is StoryScene => s !== null).slice(0, MAX_SCENES);
  if (scenes.length < 2) throw new ValidationFailed("The AI could not turn this story into scenes. Try a longer or clearer story.", { code: "STORY_PLAN_EMPTY" });
  const post = data.post && typeof data.post === "object" ? (data.post as Doc) : null;
  const postCopy = post ? { title: cl(post.title, 100), description: cl(post.description, 300), hashtags: ((post.hashtags as unknown[]) ?? []).filter((t) => String(t).trim()).map((t) => (String(t).startsWith("#") ? String(t) : `#${t}`)).slice(0, 10) } : null;
  return { title: cl(data.title, 120) || fallbackTitle, language, art_style: artStyle, music_mood: cl(data.music_mood, 30) || "devotional", characters, scenes, post_copy: postCopy, planned_by: "ai", source_text: "", seconds: 60 };
}
function simplePlan(story: string, language: string, artStyle: string, scenes: number, title: string): StoryPlan {
  const sentences = story.split(/(?<=[.!?।|])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  if (!sentences.length) throw new ValidationFailed("Write the story first.", { code: "STORY_EMPTY" });
  const n = Math.max(1, Math.min(scenes, sentences.length)), per = Math.ceil(sentences.length / n), out: StoryScene[] = [];
  for (let i = 0; i < sentences.length; i += per) { const text = sentences.slice(i, i + per).join(" ").slice(0, 600); out.push(newScene({ narration: text, visual: text.slice(0, 700), mood: "calm", shot: out.length ? "medium" : "wide" })); }
  return { title, language, art_style: artStyle, music_mood: "devotional", characters: [], scenes: out, post_copy: null, planned_by: "simple", source_text: "", seconds: 60 };
}
export async function planStory(storyIn: string, language = "hi", artStyle = "ravi_varma", scenes = 8, seconds = 60): Promise<StoryPlan> {
  const story = storyIn.trim();
  if (story.length < 40) throw new ValidationFailed("Write a little more of the story (at least a few sentences).", { code: "STORY_TOO_SHORT" });
  if (!ART_STYLES[artStyle]) throw new ValidationFailed("Unknown art style.", { code: "INVALID_ART_STYLE" });
  scenes = Math.min(Math.max(scenes, MIN_SCENES), MAX_SCENES);
  const title = cl(story.split("\n", 1)[0], 60) || "My story";
  let plan: StoryPlan;
  try {
    plan = fromAi((await getProvider().chatJson(SYSTEM, prompt(story.slice(0, 12000), seconds, scenes, LANG_NAMES[language] ?? "Hindi"), { temperature: 0.6, task: "general" })) as Doc, language, artStyle, title);
  } catch (e) {
    if (!(e instanceof AppError) || e.code === "STORY_PLAN_EMPTY") throw e;
    plan = simplePlan(story, language, artStyle, scenes, title); // no AI, or a reply that is not a plan: the plain split still works
  }
  return { ...plan, source_text: story.slice(0, 12000), seconds };
}

// ------------------------------------------------------------------ pictures, cheapest source first
interface Picture { data: Buffer; ext: string; source: string; credit: string; libraryId: string | null; ref: string }
class NoPicture extends Error {}
const extOf = (b: Buffer) => (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? "png" : "jpg");
export const cloudflareReady = () => Boolean(cfg.cloudflareAccountId && cfg.cloudflareApiToken);
export const paidReady = () => (cfg.storyPaidImages === "gemini" && cfg.geminiApiKey ? "gemini" : cfg.storyPaidImages === "openai" && cfg.openaiApiKey ? "openai" : "");
export function sourcesAvailable(artStyle: string) {
  const out = ["library"];
  if (ART_STYLES[artStyle].paintings) out.push("public_domain");
  if (cloudflareReady()) out.push("free_ai");
  if (paidReady()) out.push("paid_ai");
  return out;
}
function promptFor(plan: StoryPlan, scene: StoryScene) {
  const style = ART_STYLES[plan.art_style], looks = plan.characters.filter((c) => c.look && (scene.characters.includes(c.name) || scene.visual.toLowerCase().includes(c.name.toLowerCase()))).map((c) => `${c.name}: ${c.look}`);
  const parts = [`${style.prompt}.`, `${{ wide: "wide shot", medium: "medium shot", close: "close-up" }[scene.shot]}: ${scene.visual}`];
  if (looks.length) parts.push(`Characters: ${looks.join("; ")}.`);
  parts.push("Vertical 9:16 composition, subject in the centre. No text, no letters, no captions, no watermark, no modern objects.");
  return parts.join(" ").slice(0, 2000);
}
export function libraryKey(artStyle: string, scene: StoryScene) {
  const norm = scene.visual.toLowerCase().replace(/[^a-z0-9 ]+/g, "").split(/\s+/).filter(Boolean).join(" ");
  return crypto.createHash("sha1").update(`${artStyle}|${norm}|${[...scene.characters].sort().join(",")}`).digest("hex").slice(0, 24);
}
const plain = (s: string) => (s ?? "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ").trim();
const userAgent = () => `AIReelMaker/1.0 (${cfg.publicBaseUrl || "https://github.com/ai-reel-maker"}${cfg.contactEmail ? `; ${cfg.contactEmail}` : ""})`;
const forms = (word: string) => { const w = word.toLowerCase().trim(), out = new Set([w]); if (w.length > 4) { out.add(w.replace(/a+$/, "")); out.add(`${w}a`); } return [...out].filter((x) => x.length > 3); };
const isName = (w: string) => /^[A-Z]/.test(w) && !w.trim().includes(" ");
async function getBytes(url: string, init: RequestInit = {}, timeoutMs = 60_000): Promise<Buffer> {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
/** A public-domain painting on Wikimedia Commons for a scene (Raja Ravi Varma first); the candidate mentioning most of the
 * scene's names and words wins; preferNot = paintings other scenes already show (taken only when nothing else fits). */
async function commonsSearch(scene: StoryScene, skip: Set<string>, storyNames: string[], preferNot: Set<string>): Promise<Picture | null> {
  let names = [...new Set([...scene.characters, ...scene.keywords.filter(isName)])], words = scene.keywords.filter(Boolean).slice(0, 3);
  if (!words.length) words = names.slice(0, 2);
  if (!names.length && storyNames.length) { names = storyNames.slice(0, 2); if (!words.length) words = names; }
  if (!words.length && !names.length) return null;
  const wanted = new Map<string, number>();
  for (const w of [...scene.keywords, ...names]) for (const f of forms(w)) wanted.set(f, Math.max(wanted.get(f) ?? 0, names.includes(w) ? 2 : 1));
  const queries = [...new Set([`"Ravi Varma" ${words.join(" ")}`, `${words.join(" ")} painting`, ...names.slice(0, 3).flatMap((n) => [`"Ravi Varma" ${n}`, `${n} painting`])])];
  let best: { score: number; info: Doc; meta: Record<string, { value?: string }>; title: string } | null = null;
  const seenTitles = new Set<string>();
  for (const query of queries) {
    const url = `https://commons.wikimedia.org/w/api.php?${new URLSearchParams({ action: "query", format: "json", generator: "search", gsrnamespace: "6", gsrlimit: "15", gsrsearch: `${query} filetype:bitmap`, prop: "imageinfo", iiprop: "url|extmetadata|size", iiurlwidth: "1600" })}`;
    const data = JSON.parse((await getBytes(url, { headers: { "User-Agent": userAgent() } }, 20_000)).toString("utf8")) as { query?: { pages?: Record<string, Doc> } };
    const pages = Object.values(data.query?.pages ?? {}).sort((a, b) => Number(a.index ?? 99) - Number(b.index ?? 99));
    pages.forEach((pg, rank) => {
      const title = String(pg.title ?? "");
      if (skip.has(title) || seenTitles.has(title)) return;
      seenTitles.add(title);
      const info = (((pg.imageinfo as Doc[]) ?? [{}])[0] ?? {}) as Doc, meta = (info.extmetadata ?? {}) as Record<string, { value?: string }>;
      const licence = plain(meta.LicenseShortName?.value ?? "").toLowerCase();
      if (!(licence.includes("public domain") || licence.startsWith("pd"))) return;
      if (Math.min(Number(info.width ?? 0), Number(info.height ?? 0)) < 600) return;
      const about = `${title} ${plain(meta.ImageDescription?.value ?? "")}`.toLowerCase();
      let score = [...wanted].reduce((s, [k, w]) => s + (about.includes(k) ? w : 0), 0);
      if (score <= 0) return;
      score -= rank * 0.05;
      if (preferNot.has(title)) score -= 2.5;
      if (!best || score > best.score) best = { score, info, meta, title };
    });
    if (best && (best as { score: number }).score >= 3.5) break;
  }
  if (!best) return null;
  const b = best as { info: Doc; meta: Record<string, { value?: string }>; title: string };
  const img = await getBytes(String(b.info.thumburl || b.info.url), { headers: { "User-Agent": userAgent() } });
  let artist = (plain(b.meta.Artist?.value ?? "").split("\n")[0] ?? "").trim();
  const half = Math.trunc(artist.length / 2);
  if (half && artist.slice(0, half) === artist.slice(half)) artist = artist.slice(0, half);
  return { data: img, ext: extOf(img), source: "public_domain", credit: `${artist.slice(0, 80) || "Unknown artist"} · Wikimedia Commons (public domain)`, libraryId: null, ref: b.title };
}
async function cloudflareFlux(p: string): Promise<Picture> {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${cfg.cloudflareAccountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`, { method: "POST", headers: { Authorization: `Bearer ${cfg.cloudflareApiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: p.slice(0, 2048), steps: 6 }), signal: AbortSignal.timeout(120_000) });
  if (r.status !== 200) throw new NoPicture(`The free picture service refused the request (${r.status}): ${(await r.text()).slice(0, 160)}`);
  const data = Buffer.from(((await r.json()) as { result: { image: string } }).result.image, "base64");
  return { data, ext: extOf(data), source: "free_ai", credit: "AI picture (FLUX.1 schnell)", libraryId: null, ref: "" };
}
async function paidPicture(p: string): Promise<Picture> {
  const which = paidReady();
  let data: Buffer;
  if (which === "gemini") {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${cfg.geminiImageModel}:generateContent`, { method: "POST", headers: { "x-goog-api-key": cfg.geminiApiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: p }] }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "9:16" } } }), signal: AbortSignal.timeout(180_000) });
    if (r.status !== 200) throw new NoPicture(`The paid picture service refused the request (${r.status}).`);
    const parts = (((await r.json()) as { candidates: { content: { parts: { inlineData?: { data: string } }[] } }[] }).candidates[0]?.content.parts ?? []);
    const part = parts.find((x) => x.inlineData);
    if (!part) throw new NoPicture("The paid picture service returned no picture.");
    data = Buffer.from(part.inlineData!.data, "base64");
  } else {
    const r = await fetch("https://api.openai.com/v1/images/generations", { method: "POST", headers: { Authorization: `Bearer ${cfg.openaiApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: cfg.openaiImageModel, prompt: p, size: "1024x1536", quality: "medium", n: 1 }), signal: AbortSignal.timeout(180_000) });
    if (r.status !== 200) throw new NoPicture(`The paid picture service refused the request (${r.status}).`);
    data = Buffer.from(((await r.json()) as { data: { b64_json: string }[] }).data[0].b64_json, "base64");
  }
  return { data, ext: extOf(data), source: "paid_ai", credit: `AI picture (${which})`, libraryId: null, ref: "" };
}

// the studio-wide picture library: a picture made or found for one description is reused for the next person
const LIBRARY_ROOT = "shared/story_images", MAX_UPLOAD = 15 * 1024 * 1024;
async function libraryGet(key: string, artStyle: string, scene: StoryScene, skip: Set<string>): Promise<Picture | null> {
  const col = (await db()).collection<Doc>("story_images");
  let doc: Doc | null = skip.has(key) ? null : await col.findOne({ _id: key as never });
  if (!doc) {
    const words = [...new Set([...scene.keywords, ...scene.characters].filter(Boolean).map((w) => w.toLowerCase()))].sort();
    if (words.length < 2) return null;
    let bestScore = 0;
    for (const d of await col.find({ style: artStyle, tags: { $in: words } }).limit(50).toArray()) {
      if (skip.has(String(d._id))) continue;
      const tags = new Set((d.tags as string[]) ?? []), inter = words.filter((w) => tags.has(w)).length, score = inter / new Set([...tags, ...words]).size;
      if (score > bestScore) { doc = d; bestScore = score; }
    }
    if (bestScore < 0.6) return null; // only a close match: the same people and things
  }
  const file = localPath(String(doc!.key));
  if (!fs.existsSync(file)) return null;
  return { data: fs.readFileSync(file), ext: String(doc!.ext ?? "jpg"), source: "library", credit: String(doc!.credit ?? ""), libraryId: String(doc!._id), ref: String(doc!._id) };
}
async function libraryRemember(key: string, artStyle: string, scene: StoryScene, pic: Picture): Promise<string> {
  if (pic.source === "library") return pic.libraryId || key;
  const skey = `${LIBRARY_ROOT}/${key}.${pic.ext}`, file = localPath(skey);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, pic.data);
  await (await db()).collection<Doc>("story_images").updateOne({ _id: key as never }, { $set: { key: skey, ext: pic.ext, style: artStyle, tags: [...new Set([...scene.keywords, ...scene.characters].filter(Boolean).map((w) => w.toLowerCase()))].sort(),
    source: pic.source, credit: pic.credit, visual: scene.visual.slice(0, 300), createdAt: new Date() } }, { upsert: true });
  return key;
}
async function findPicture(plan: StoryPlan, scene: StoryScene, skip: Set<string>, used: Set<string>): Promise<Picture> {
  const errors: string[] = [], hit = await libraryGet(libraryKey(plan.art_style, scene), plan.art_style, scene, skip);
  if (hit) return hit;
  if (ART_STYLES[plan.art_style].paintings) {
    try { const pic = await commonsSearch(scene, skip, plan.characters.map((c) => c.name), used); if (pic) return pic; } catch (e) { errors.push(`paintings: ${(e as Error).message}`); }
  }
  const p = promptFor(plan, scene);
  for (const [name, ready, make] of [["free AI", cloudflareReady, cloudflareFlux], ["paid AI", paidReady, paidPicture]] as const) {
    if (!ready()) continue;
    try { return await make(p); } catch (e) { errors.push(`${name}: ${(e as Error).message}`); }
  }
  if (!cloudflareReady() && !paidReady()) throw new NoPicture("No more pictures for this scene. Upload your own picture, or ask the admin to connect the free AI pictures (Cloudflare).");
  throw new NoPicture(`Could not get a picture for this scene right now. Try again, or upload your own. ${errors.join(" · ").slice(0, 300)}`);
}
async function checkImage(data: Buffer): Promise<[number, number]> {
  let meta;
  try { meta = await sharp(data).metadata(); } catch { meta = null; }
  if (!meta?.width || !meta.height) throw new ValidationFailed("That file is not a picture we can read (use JPG or PNG).", { code: "INVALID_IMAGE" });
  if (Math.min(meta.width, meta.height) < 320) throw new ValidationFailed("The picture is too small (at least 320 pixels on each side).", { code: "IMAGE_TOO_SMALL" });
  return [meta.width, meta.height];
}

// ------------------------------------------------------------------ the story project
export function getStory(doc: Doc): StoryPlan {
  if ((doc.settings as Doc | undefined)?.reelType !== "story" || !doc.story) throw new ValidationFailed("This project is not a story Reel.", { code: "NOT_A_STORY_PROJECT" });
  return planOf(doc.story as Doc);
}
export async function saveStory(projectOid: ObjectId, plan: StoryPlan) { await (await db()).collection("projects").updateOne({ _id: projectOid }, { $set: { story: plan, updatedAt: new Date() } }); }
export function sceneOf(plan: StoryPlan, sceneId: string): StoryScene {
  const s = plan.scenes.find((x) => x.id === sceneId);
  if (!s) throw new NotFoundError("Scene not found.", { code: "SCENE_NOT_FOUND" });
  return s;
}
function storeScenePicture(projectId: string, scene: StoryScene, data: Buffer, ext: string) {
  const key = projectKey(projectId, "input", `scene_${scene.id}_${crypto.randomUUID().replace(/-/g, "").slice(0, 6)}.${ext}`), file = localPath(key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  if (scene.image_key) fs.rmSync(localPath(scene.image_key), { force: true }); // the previous picture of this scene
  return key;
}
/** Give a scene a picture (or the next one, with `another`): cheapest source first, remembered in the library. */
export async function findScenePicture(doc: Doc, sceneId: string, another = false) {
  const plan = getStory(doc), scene = sceneOf(plan, sceneId), skip = new Set(another ? scene.seen : []);
  if (another && scene.library_id) skip.add(scene.library_id);
  const key = libraryKey(plan.art_style, scene);
  if (another) skip.add(key);
  const used = new Set(plan.scenes.filter((s) => s.id !== scene.id).flatMap((s) => s.seen));
  let pic: Picture;
  try { pic = await findPicture(plan, scene, skip, used); } catch (e) { if (e instanceof NoPicture) throw new ValidationFailed(e.message, { code: "NO_PICTURE" }); throw e; }
  await checkImage(pic.data);
  if (pic.source === "free_ai" || pic.source === "paid_ai") await charge(pic.source === "paid_ai" ? "paid_picture" : "ai_picture", `picture_${doc._id}_${scene.id}_${crypto.randomUUID().slice(0, 6)}`, "AI picture for a story scene"); // made just now (the library and paintings are free)
  const libId = await libraryRemember(pic.source !== "public_domain" ? key : `pd_${crypto.createHash("sha1").update(pic.ref).digest("hex").slice(0, 20)}`, plan.art_style, scene, pic);
  scene.image_key = storeScenePicture(String(doc._id), scene, pic.data, pic.ext);
  Object.assign(scene, { source: pic.source, credit: pic.credit, library_id: libId });
  scene.seen = [...new Set([...scene.seen, ...[pic.ref, libId].filter(Boolean)])].slice(-30);
  await saveStory(doc._id as ObjectId, plan);
}
export async function uploadScenePicture(doc: Doc, sceneId: string, data: Buffer) {
  const plan = getStory(doc), scene = sceneOf(plan, sceneId);
  if (data.length > MAX_UPLOAD) throw new ValidationFailed("The picture is larger than 15 MB.", { code: "IMAGE_TOO_LARGE" });
  await checkImage(data);
  scene.image_key = storeScenePicture(String(doc._id), scene, data, extOf(data));
  Object.assign(scene, { source: "upload", credit: "Your picture", library_id: null });
  await saveStory(doc._id as ObjectId, plan);
}
/** The person's edits: text, order, deletions, new scenes; a scene whose description changed loses its picture. */
export function editPlan(plan: StoryPlan, title: string, scenes: { id: string; narration: string; visual: string }[]): StoryPlan {
  const old = new Map(plan.scenes.map((s) => [s.id, s])), out: StoryScene[] = [];
  for (const d of scenes.slice(0, 14)) {
    const narration = d.narration.trim().slice(0, 600), visual = d.visual.trim().slice(0, 700);
    if (!narration) continue;
    const prev = old.get(d.id);
    if (!prev) { out.push(newScene({ narration, visual: visual || narration.slice(0, 700) })); continue; }
    const changed = visual && visual !== prev.visual;
    out.push({ ...prev, narration, visual: visual || prev.visual, ...(changed && prev.source !== "upload" ? { image_key: null, source: null, credit: "", library_id: null, seen: [] } : {}) });
  }
  if (out.length < 2) throw new ValidationFailed("A story needs at least 2 scenes.", { code: "STORY_TOO_FEW_SCENES" });
  return { ...plan, title: title.trim().slice(0, 120) || plan.title, scenes: out };
}
const camelKey = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
/** The plan as the page reads it (camelCase, a URL per scene picture, without the story text). */
export function storyOut(doc: Doc, plan: StoryPlan) {
  const pid = String(doc._id), data: Doc = Object.fromEntries(Object.entries(plan).filter(([k]) => k !== "source_text").map(([k, v]) => [camelKey(k), v]));
  data.characters = plan.characters;
  data.scenes = plan.scenes.map((s) => {
    const o: Doc = Object.fromEntries(Object.entries(s).filter(([k]) => k !== "image_key" && k !== "seen").map(([k, v]) => [camelKey(k), v]));
    o.imageUrl = s.image_key ? `/api/projects/${pid}/story/scenes/${s.id}/image?v=${s.image_key.slice(-10)}` : null;
    return o;
  });
  return { projectId: pid, ...data };
}
const NARRATORS: [string, string][] = [["gemini:Orus", "Orus · deep, firm (male)"], ["gemini:Charon", "Charon · calm storyteller (male)"], ["gemini:Algenib", "Algenib · gravelly, epic (male)"], ["gemini:Kore", "Kore · firm (female)"],
  ["gemini:Despina", "Despina · smooth (female)"], ["gemini:Aoede", "Aoede · gentle (female)"], ["none", "No narration (captions + music only)"]];
const OPENAI_NARRATORS: [string, string][] = [["openai:onyx", "Onyx · deep (male, OpenAI)"], ["openai:ballad", "Ballad · storyteller (male, OpenAI)"], ["openai:ash", "Ash · warm (male, OpenAI)"], ["openai:fable", "Fable · narrator (OpenAI)"],
  ["openai:nova", "Nova · friendly (female, OpenAI)"], ["openai:shimmer", "Shimmer · clear (female, OpenAI)"]];
export function storyOptions() {
  const n = [...NARRATORS.filter(([i]) => i.startsWith("gemini:") && cfg.geminiApiKey), ...(cfg.openaiApiKey ? OPENAI_NARRATORS : []), ...NARRATORS.filter(([i]) => i === "none")];
  return { artStyles: Object.values(ART_STYLES).map((s) => ({ id: s.id, name: s.name, paintings: s.paintings, sources: sourcesAvailable(s.id) })), narrators: n.map(([id, name]) => ({ id, name })), freeAi: cloudflareReady(), paidAi: Boolean(paidReady()) };
}

// ------------------------------------------------------------------ narration and render
const SR = 48000, LEAD = 0.5, GAP = 0.45, MIN_SCENE = 3, WORDS_PER_SECOND = 2.4, LANG_TAGS: Record<string, string> = { en: "en-US", hi: "hi-IN", mr: "mr-IN", hinglish: "en-IN" };
const MOOD_VOICE: Record<string, string> = { calm: "calm", devotional: "calm", sad: "calm", joyful: "friendly", tense: "serious", epic: "serious", mysterious: "serious" };
const STORY_STYLE: ProductStyle = { ...getProductStyle("luxury_jewelry"), id: "story", name: "Story", description: "Slow, painterly camera; soft light; captions under the picture.", pace: 0.8, push: 0.12, swayDeg: 0.4, sparkleMax: 0,
  lightSweeps: 0, glow: 0.12, lightLeaks: 0, dust: false, flashOnDrops: false, whip: false, vignette: 0.34, contrast: 1.04, saturation: 1.03, altTransitions: ["dissolve"], font: "Georgia", textColor: "#FFF4DC" };
interface Line { scene: StoryScene; start: number; length: number; voice: Float32Array | null }
async function readMono(file: string, work: string): Promise<Float32Array> {
  const raw = path.join(work, `${path.basename(file)}.f32`);
  await renderFfmpeg(["-i", file, "-f", "f32le", "-ac", "1", "-ar", String(SR), raw], { timeout: 300 });
  const b = fs.readFileSync(raw);
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}
function writeWav(file: string, data: Float32Array) {
  const buf = Buffer.alloc(44 + data.length * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + data.length * 2, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(data.length * 2, 40);
  for (let i = 0; i < data.length; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(data[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(file, buf);
}
const endsLine = (text: string) => { const t = text.trim(); return /[.!?।|…]$/.test(t) ? t : /[ऀ-ॿ]/.test(t) ? `${t}।` : `${t}.`; };
/** One recording of the whole story -> one piece per scene, cut in the pauses nearest to where each scene should end. */
function splitNarration(audio: Float32Array, texts: string[]): Float32Array[] {
  const n = texts.length;
  if (n <= 1 || audio.length < SR) return [audio];
  const hop = Math.trunc(0.02 * SR), frames = Math.trunc(audio.length / hop), rms = new Float64Array(frames);
  for (let f = 0; f < frames; f++) { let s = 0; for (let i = f * hop; i < (f + 1) * hop; i++) s += audio[i] * audio[i]; rms[f] = Math.sqrt(s / hop + 1e-12); }
  const sorted = Float64Array.from(rms).sort(), p95 = sorted[Math.min(Math.round(0.95 * (frames - 1)), frames - 1)], thr = Math.max(p95 * 0.06, 1e-4), gaps: [number, number][] = [];
  for (let i = 0; i < frames;) {
    if (rms[i] < thr) { let j = i; while (j < frames && rms[j] < thr) j++; if (i > 0 && j < frames && (j - i) * 0.02 >= 0.16) gaps.push([((i + j) / 2) * 0.02, (j - i) * 0.02]); i = j; } else i++;
  }
  const total = audio.length / SR, weights = texts.map((t) => Math.max(t.length, 1)), wsum = weights.reduce((a, b) => a + b, 0), cuts: number[] = [];
  let prev = 0;
  for (let k = 1; k < n; k++) {
    const expected = (total * weights.slice(0, k).reduce((a, b) => a + b, 0)) / wsum, options = gaps.filter((g) => g[0] > prev + 0.5);
    let mid = expected;
    if (options.length) { mid = options.reduce((m, g) => (Math.abs(g[0] - expected) - 0.6 * g[1] < Math.abs(m[0] - expected) - 0.6 * m[1] ? g : m))[0]; if (Math.abs(mid - expected) > Math.max(2.5, (0.35 * total) / n)) mid = expected; }
    mid = Math.max(mid, prev + 0.5);
    cuts.push(mid); prev = mid;
  }
  const bounds = [0, ...cuts.map((c) => Math.trunc(c * SR)), audio.length];
  return bounds.slice(1).map((b, i) => {
    let seg = audio.subarray(bounds[i], b);
    let first = -1, last = -1;
    for (let j = 0; j < seg.length; j++) if (Math.abs(seg[j]) > thr) { if (first < 0) first = j; last = j; }
    if (first >= 0) { const pad = Math.trunc(0.05 * SR); seg = seg.subarray(Math.max(first - pad, 0), Math.min(last + pad, seg.length)); }
    return Float32Array.from(seg);
  });
}
async function speak(plan: StoryPlan, voiceId: string | null, work: string, progress: (f: number) => void): Promise<[(Float32Array | null)[], string[]]> {
  if (voiceId === "none") { progress(1); return [plan.scenes.map(() => null), []]; }
  const provider = voiceProvider(), tag = LANG_TAGS[plan.language] ?? "hi-IN", warnings: string[] = [];
  let voice;
  try { voice = await provider.findVoice(tag, voiceId); } catch (e) { return [plan.scenes.map(() => null), [`No voice for this language (${(e as Error).message}); the Reel has captions only.`]]; }
  const texts = plan.scenes.map((s) => endsLine(s.narration));
  if (voice.id.startsWith("gemini:") || voice.id.startsWith("openai:")) {
    const wav = path.join(work, "narration_full.wav"), moods = plan.scenes.map((s) => s.mood), mood = [...new Set(moods)].reduce((m, x) => (moods.filter((y) => y === x).length > moods.filter((y) => y === m).length ? x : m));
    progress(0.1);
    await provider.synthesize(buildSsml(texts.join("\n\n"), speech({ emotion: MOOD_VOICE[mood] ?? "calm", pauseStyle: "dramatic" }), tag), voice.id, wav); // quota / unavailable stop the Reel with their message
    progress(0.8);
    const pieces = splitNarration(await readMono(wav, work), texts);
    progress(1);
    return [[...pieces, ...texts.slice(pieces.length).map(() => null)], warnings];
  }
  const out: (Float32Array | null)[] = [];
  for (const [i, s] of plan.scenes.entries()) {
    const wav = path.join(work, `line_${String(i).padStart(2, "0")}.wav`);
    try {
      await provider.synthesize(buildSsml(texts[i], speech({ emotion: MOOD_VOICE[s.mood] ?? "calm", pauseStyle: "natural" }), tag), voice.id, wav);
      out.push(await readMono(wav, work));
    } catch (e) {
      if (e instanceof AppError && e.code.includes("QUOTA")) throw e;
      warnings.push(`Scene ${i + 1}: the voice could not be made (${String((e as Error).message).slice(0, 80)}); it is shown with captions only.`);
      out.push(null);
    }
    progress((i + 1) / plan.scenes.length);
  }
  return [out, warnings];
}
function timeLines(plan: StoryPlan, voices: (Float32Array | null)[]): Line[] {
  const lines: Line[] = [];
  let t = LEAD;
  plan.scenes.forEach((s, i) => {
    const v = voices[i] ?? null, spoken = v ? v.length / SR : s.narration.split(/\s+/).filter(Boolean).length / WORDS_PER_SECOND, length = Math.max(spoken + GAP, MIN_SCENE);
    lines.push({ scene: s, start: t, length, voice: v });
    t += length;
  });
  lines[0].start = 0; lines[0].length += LEAD; // the first picture is already there during the lead-in
  return lines;
}
/** A slow move that suits the picture: across a wide painting, into a tall one; never past its edges. */
function camera(i: number, shot: string, iw: number, ih: number, push: number): CameraMove {
  const wide = iw / ih > 0.9;
  let hh = 1, half = (hh * ih * 9) / 16 / (2 * iw);
  if (half >= 0.5) { hh = (iw * 16) / 9 / ih; half = 0.5; }
  const cy = hh >= 1 ? 0.5 : Math.min(Math.max(0.42, hh / 2), 1 - hh / 2), v = (cx: number, y: number, h: number): View => ({ cx, cy: y, hh: h, roll: 0 });
  if (wide && half < 0.42) {
    const left = v(half + 0.02, cy, hh), right = v(1 - half - 0.02, cy, hh);
    return i % 2 === 0 ? { type: "pan_right", start: left, end: right, ease: "in_out" } : { type: "pan_left", start: right, end: left, ease: "in_out" };
  }
  const tight = hh * (1 - push * (shot === "close" ? 1.6 : 1)), ty = Math.min(Math.max(0.42, tight / 2), 1 - tight / 2), a = v(0.5, cy, hh), b = v(0.5, ty, tight);
  return i % 2 === 0 ? { type: "push_in", start: a, end: b, ease: "out" } : { type: "pull_out", start: b, end: a, ease: "in_out" };
}
function chunks(text: string, width = 20): string[] {
  const out: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/).filter(Boolean)) { if (cur && cur.length + 1 + w.length > width) { out.push(cur); cur = w; } else cur = `${cur} ${w}`.trim(); }
  if (cur) out.push(cur);
  return out.length ? out : [text];
}
function buildPlan(plan: StoryPlan, lines: Line[], sizes: [number, number][], style: ProductStyle, reference: Doc | null): ProductReelPlan {
  const target = Number(reference?.median_shot || reference?.avg_shot || 0);
  const hardCuts = ((reference?.traits as Doc | undefined)?.transition_style === "mostly_hard_cut") || (reference !== null && Number(reference.median_shot || 9) <= 1);
  const shots: Shot[] = [], texts: TextLayer[] = [];
  let shotNo = 0;
  lines.forEach((ln, i) => {
    const [iw, ih] = sizes[i], n = target ? Math.trunc(Math.max(1, Math.min(4, Math.round(ln.length / Math.max(target * 1.6, 1.2))))) : 1;
    for (let j = 0; j < n; j++) {
      const tr = i === 0 && j === 0 ? { type: "fade_from_black", duration: 0.7 } : j > 0 || hardCuts ? { type: "cut", duration: 0 } : { type: "dissolve", duration: 0.6 };
      shots.push({ index: shotNo++, start: ln.start + (ln.length * j) / n, end: ln.start + (ln.length * (j + 1)) / n, purpose: i === 0 ? "hook" : "hero", framing: "hero", imageIndex: i,
        camera: camera(i + j, n > 1 ? ["wide", "close", "medium", "close"][j % 4] : ln.scene.shot, iw, ih, style.push), effects: [], transitionIn: tr, beatTime: null, note: ln.scene.narration.slice(0, 80) });
    }
    const spoken = ln.voice ? ln.voice.length / SR : ln.scene.narration.split(/\s+/).filter(Boolean).length / WORDS_PER_SECOND, cs = chunks(ln.scene.narration.replace(/\s+/g, " ").trim());
    const total = cs.reduce((s, c) => s + c.length, 0) || 1;
    let t = ln.start + (i === 0 ? LEAD : 0);
    cs.forEach((c, k) => { const d = (spoken * c.length) / total; texts.push({ id: `c${i}_${k}`, text: c, start: t, end: t + d, x: 0.5, y: 0.82, size: 0.042, animationIn: "fade", animationOut: "none", role: "tagline" }); t += d; });
  });
  const duration = lines[lines.length - 1].start + lines[lines.length - 1].length + 0.6;
  shots[shots.length - 1].end = duration;
  texts.unshift({ id: "title", text: plan.title.slice(0, 60), start: 0.25, end: Math.min(2.8, lines[0].length), x: 0.5, y: 0.15, size: 0.055, animationIn: "blur_sharp", animationOut: "fade", role: "hook" });
  return { postCopy: plan.post_copy, style: style.id, duration: Math.round(duration * 1000) / 1000, fps: 30, bpm: 0, audioStart: 0, concept: { hook: plan.scenes[0].narration.slice(0, 120), story: plan.title },
    images: lines.map((l) => l.scene.id), shots, texts, loop: false, warnings: [], notes: [], quality: [] };
}
export async function runStory(inp: PipelineInput, progress: StageProgress): Promise<PipelineResult> {
  const plan = planOf(inp.story ?? {}), missing = plan.scenes.map((s, i) => (!s.image_key || !fs.existsSync(localPath(s.image_key)) ? i + 1 : 0)).filter(Boolean);
  if (missing.length) throw new ValidationFailed(`Scene ${missing.join(", ")} has no picture any more. Get or upload a picture for it, then make the Reel again.`, { code: "STORY_PICTURES_MISSING" });
  const res = newResult(), outKey = projectKey(inp.projectId, "output", `${inp.kind === "preview" ? "preview_" : ""}${inp.renderingId}.mp4`), out = localPath(outKey);
  const work = localPath(projectKey(inp.projectId, "temp", `story_${inp.renderingId}`)), music = inp.audio ? localPath(inp.audio.key) : null, reference = ((inp.template ?? {}) as Doc).profile as Doc | undefined ?? null;
  fs.mkdirSync(work, { recursive: true });
  try {
    const [voices, warnings] = await speak(plan, inp.voiceId, work, (f) => progress("voicing", f)), lines = timeLines(plan, voices), pictures = plan.scenes.map((s) => localPath(s.image_key!));
    const sizes: [number, number][] = [];
    for (const p of pictures) { const m = await sharp(p).rotate().metadata(); if (!m.width || !m.height) throw new ValidationFailed(`A scene picture could not be read: ${path.basename(p)}`); const o = (m.orientation ?? 1) >= 5; sizes.push(o ? [m.height, m.width] : [m.width, m.height]); }
    let style = STORY_STYLE;
    if (["hi", "mr"].includes(plan.language)) style = { ...style, font: process.platform === "win32" ? "Nirmala UI" : "Noto Sans Devanagari" };
    const look = reference?.look as Doc | undefined;
    if (look) { const sat = Number(look.saturation ?? 0.4); style = { ...style, saturation: Math.round((1 + Math.max(-0.15, Math.min(0.25, (sat - 0.4) * 0.8))) * 100) / 100, contrast: Math.round((1.04 + Math.max(-0.04, Math.min(0.06, (sat - 0.4) * 0.2))) * 100) / 100 }; }
    const reel = buildPlan(plan, lines, sizes, style, reference), voiced = voices.some((v) => v !== null);
    const rs = { ...(inp.kind === "final" ? { ...FINAL, fps: 25 } : PREVIEW), musicVolume: voiced ? 0.22 : 0.8 }, silent = path.join(work, "pictures.mp4");
    await renderReel(reel, pictures, style, silent, path.join(work, "frames"), { music, settings: rs, progress: (f) => progress("rendering", f * 0.95), signal: inp.signal });
    if (voiced) {
      const track = new Float32Array(Math.trunc((reel.duration + 1) * SR));
      lines.forEach((ln, i) => { if (!ln.voice) return; const a = Math.trunc((ln.start + (i === 0 ? LEAD : 0)) * SR); for (let j = 0; j < ln.voice.length && a + j < track.length; j++) track[a + j] += ln.voice[j]; });
      let peak = 0;
      for (const x of track) peak = Math.max(peak, Math.abs(x));
      const k = Math.min(0.95 / (peak || 1), 4), narration = path.join(work, "narration.wav");
      writeWav(narration, track.map((x) => x * k));
      const graph = music ? "[1:a]aresample=48000[v];[0:a][v]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]" : "[1:a]aresample=48000,apad[a]";
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await renderFfmpeg(["-i", silent, "-i", narration, "-filter_complex", graph, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", reel.duration.toFixed(3), "-movflags", "+faststart", out], { timeout: 300 });
    } else { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.copyFileSync(silent, out); }
    progress("rendering", 1);
    res.productPlan = reel as unknown as Doc;
    res.warnings = warnings;
    res.postCopy = plan.post_copy;
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
  const info = await probe(out), v = (info.streams ?? []).find((s) => s.codec_type === "video");
  res.render = { path: out, duration: Number(info.format?.duration ?? 0), width: Number(v?.width ?? 0), height: Number(v?.height ?? 0), size: fs.statSync(out).size };
  res.outputKey = outKey;
  return res;
}
