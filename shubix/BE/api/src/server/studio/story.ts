import crypto from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { getProvider } from "../ai";
import { settings as cfg } from "../core/config";
import { AppError, ValidationFailed } from "../core/errors";
import { chargeOnce, refund } from "../credits";

/** Story Maker from words alone: each sentence becomes a scene with a picture, found or made here, cheapest first:
 * a free-licence painting or photo on Wikimedia Commons, then free AI (Cloudflare FLUX, when connected), then paid AI
 * (STORY_PAID_IMAGES). The phone narrates the story, moves over each picture and adds the captions. */

export interface ArtStyle { id: string; name: string; prompt: string; commons: "painting" | "photo" | "" }
export const ART_STYLES: ArtStyle[] = [
  { id: "classical", name: "Classical painting", prompt: "classical Indian oil painting in the style of Raja Ravi Varma, rich deep colours, soft golden light, fine detail", commons: "painting" },
  { id: "photo", name: "Real photos", prompt: "realistic photograph, natural light, sharp detail, documentary style", commons: "photo" },
  { id: "cinematic", name: "Cinematic", prompt: "cinematic realistic film still, dramatic lighting, epic scale, shallow depth of field, rich colour grade", commons: "" },
  { id: "anime", name: "Anime", prompt: "detailed anime illustration, vibrant colours, soft cel shading, beautiful background art", commons: "" },
  { id: "watercolor", name: "Storybook", prompt: "soft storybook watercolour illustration, gentle colours, paper texture, warm and calm", commons: "" },
  { id: "comic", name: "Comic book", prompt: "classic Indian comic book illustration, clean ink lines, flat bright colours, expressive faces", commons: "" },
];
const styleOf = (id: string) => ART_STYLES.find((s) => s.id === id) ?? ART_STYLES[0];
export const MAX_SCENES = 12;

const freeAi = () => Boolean(cfg.cloudflareAccountId && cfg.cloudflareApiToken);
const paidAi = () => (cfg.storyPaidImages === "gemini" && cfg.geminiApiKey ? "gemini" : cfg.storyPaidImages === "openai" && cfg.openaiApiKey ? "openai" : "");
/** The styles this studio can show: the AI-only ones need the free or paid AI pictures connected. */
export function storyOptions(aiPlan = true) {
  const ai = aiPlan && (freeAi() || !!paidAi()); // AI pictures: connected, and Shubix AI in the person's plan (Editor, Pro)
  return { styles: ART_STYLES.filter((s) => s.commons || ai).map(({ id, name, commons }) => ({ id, name, free: !!commons })), aiPictures: ai, maxScenes: MAX_SCENES };
}

// ------------------------------------------------------------------ the plan: what each scene shows
export interface Scene { text: string; visual: string; keywords: string[] }
const PlanOut = z.object({
  characters: z.array(z.object({ name: z.string(), look: z.string() })).max(8).default([]),
  scenes: z.array(z.object({ visual: z.string(), keywords: z.array(z.string()).max(6).default([]) })),
});
const SYSTEM = `You turn a short story into picture briefs for a vertical video. For every scene (given in order), write one English sentence describing what the picture shows (people, place, action, light; no text in the picture) and 2-5 English search keywords: the names of people or gods first, then the main things. Also list the main characters with a short look (clothes, age, colours) so pictures stay consistent. Answer as JSON.`;
const STOP = new Set("the and that with from this then there their they were have been into upon when what which while after before about would could should your yours very more most only also just like over under".split(" "));
/** Without the AI: the scene's own longer words and names. */
const simpleScene = (text: string): Scene => {
  const words = [...new Set(text.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w.toLowerCase())))];
  const names = words.filter((w) => /^\p{Lu}/u.test(w)), rest = words.filter((w) => !names.includes(w)).sort((a, b) => b.length - a.length);
  return { text, visual: text, keywords: [...names, ...rest].slice(0, 4) };
};
/** Group the sentences into at most MAX_SCENES scenes (in order), then brief each. */
export async function planStory(sentences: string[], style: string, ai = true) {
  const s = sentences.map((x) => x.trim()).filter(Boolean).slice(0, 80);
  if (!s.length) throw new ValidationFailed("Write a few sentences first.", { code: "STORY_EMPTY" });
  const per = Math.ceil(s.length / MAX_SCENES), texts: string[] = [];
  for (let i = 0; i < s.length; i += per) texts.push(s.slice(i, i + per).join(" "));
  try {
    if (!ai) throw new Error("no Shubix AI on this plan"); // Free: the plain plan below (Shubix AI is Editor and Pro)
    const out = await getProvider("general").structured(SYSTEM, `Picture style: ${styleOf(style).name}.\nScenes:\n${texts.map((t, i) => `${i + 1}. ${t}`).join("\n")}`, PlanOut, { temperature: 0.4, maxOutputTokens: 2500 });
    if (out.scenes.length !== texts.length) throw new Error("scene count");
    return { scenes: texts.map((text, i) => ({ text, visual: out.scenes[i].visual.slice(0, 400), keywords: out.scenes[i].keywords.map((k) => k.slice(0, 40)).filter(Boolean) })), characters: out.characters, per, by: "ai" };
  } catch {
    return { scenes: texts.map(simpleScene), characters: [] as { name: string; look: string }[], per, by: "simple" }; // no AI, or an odd answer: the plain words still find pictures
  }
}

// ------------------------------------------------------------------ one scene's picture
interface Picture { data: Buffer; source: "commons" | "free_ai" | "paid_ai"; credit: string; ref: string }
const plain = (s: string) => (s ?? "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ").trim();
const agent = () => `ShubixStory/1.0 (${cfg.publicBaseUrl || "http://localhost"}${cfg.contactEmail ? `; ${cfg.contactEmail}` : ""})`;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_PROVIDER_JSON_BYTES = 20 * 1024 * 1024;
async function readBounded(r: Response, maxBytes: number) {
  const declared = Number(r.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error("Response is too large");
  if (!r.body) {
    const b = Buffer.from(await r.arrayBuffer());
    if (b.length > maxBytes) throw new Error("Response is too large");
    return b;
  }
  const reader = r.body.getReader(), chunks: Buffer[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { try { await reader.cancel(); } catch { /* preserve the size-limit error */ } throw new Error("Response is too large"); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}
async function bytes(url: string, init: RequestInit = {}, ms = 45_000, maxBytes = 3 * 1024 * 1024, contentType?: string) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  if (contentType && !String(r.headers.get("content-type") || "").toLowerCase().startsWith(contentType)) throw new Error("Unexpected response content type");
  return readBounded(r, maxBytes);
}
async function providerJson<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`AI image provider: ${r.status}`);
  const type = String(r.headers.get("content-type") || "").toLowerCase();
  if (!type.includes("application/json")) throw new Error("AI image provider returned a non-JSON response");
  return JSON.parse((await readBounded(r, MAX_PROVIDER_JSON_BYTES)).toString("utf8")) as T;
}
const FREE_LICENCE = /public domain|^pd|cc0|^cc[ -]by(-sa)?\b/i;
/** A free-licence painting or photo on Wikimedia Commons; the one mentioning most of the scene's words wins. */
async function commons(scene: Scene, kind: "painting" | "photo", skip: Set<string>): Promise<Picture | null> {
  const k = scene.keywords.filter((w) => !/^(classical|painting|photo|picture|image|art)$/i.test(w)).slice(0, 4);
  if (!k.length) return null;
  // the main subject (a name, the crow…) first: a picture of it beats one of the scene's other words
  const main = k[0].toLowerCase(), rest = k.slice(1).map((w) => w.toLowerCase()).filter((w) => w.length > 2);
  const queries = kind === "painting" ? [`${k.slice(0, 2).join(" ")} painting`, `"Ravi Varma" ${k[0]}`, `${k[0]} painting`, `${k[0]} illustration`] : [k.slice(0, 3).join(" "), k.slice(0, 2).join(" "), k[0]];
  let best: { score: number; url: string; title: string; credit: string } | null = null;
  for (const q of [...new Set(queries)]) {
    const url = `https://commons.wikimedia.org/w/api.php?${new URLSearchParams({ action: "query", format: "json", generator: "search", gsrnamespace: "6", gsrlimit: "20", gsrsearch: `${q} filetype:bitmap`, prop: "imageinfo", iiprop: "url|extmetadata|size", iiurlwidth: "1400" })}`;
    const data = JSON.parse((await bytes(url, { headers: { "User-Agent": agent() } }, 15_000)).toString("utf8")) as { query?: { pages?: Record<string, Record<string, unknown>> } };
    for (const pg of Object.values(data.query?.pages ?? {})) {
      const title = String(pg.title ?? ""), info = ((pg.imageinfo as Record<string, unknown>[] | undefined)?.[0] ?? {}) as Record<string, unknown>;
      const meta = (info.extmetadata ?? {}) as Record<string, { value?: string }>, licence = plain(meta.LicenseShortName?.value ?? "");
      if (skip.has(title) || !FREE_LICENCE.test(licence) || Math.min(Number(info.width ?? 0), Number(info.height ?? 0)) < 500) continue;
      const about = `${title} ${plain(meta.ImageDescription?.value ?? "")} ${plain(meta.Categories?.value ?? "")}`.toLowerCase();
      const hasMain = about.includes(main), score = (hasMain ? 4 : 0) + rest.reduce((n, w) => n + (about.includes(w) ? 1 : 0), 0) - Number(pg.index ?? 0) * 0.03;
      if (score < 1 || (best && score <= best.score)) continue;
      const artist = (plain(meta.Artist?.value ?? "").split("\n")[0] || "Unknown").slice(0, 60);
      best = { score, url: String(info.thumburl || info.url), title, credit: `${artist} · Wikimedia Commons (${licence})` };
    }
    if (best && best.score >= 5) break; // the main subject and more of the scene
  }
  if (!best) return null;
  return { data: await bytes(best.url, { headers: { "User-Agent": agent() } }, 45_000, MAX_IMAGE_BYTES, "image/"), source: "commons", credit: best.credit, ref: best.title };
}
function promptFor(scene: Scene, style: ArtStyle, characters: { name: string; look: string }[]) {
  const looks = characters.filter((c) => c.look && scene.visual.toLowerCase().includes(c.name.toLowerCase())).map((c) => `${c.name}: ${c.look}`);
  return [`${style.prompt}.`, scene.visual, looks.length ? `Characters: ${looks.join("; ")}.` : "", "Vertical 9:16 composition, subject in the centre. No text, no letters, no watermark."].filter(Boolean).join(" ").slice(0, 2000);
}
async function flux(p: string): Promise<Picture> {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${cfg.cloudflareAccountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`, { method: "POST",
    headers: { Authorization: `Bearer ${cfg.cloudflareApiToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ prompt: p, steps: 6 }), signal: AbortSignal.timeout(90_000) });
  if (!r.ok) throw new Error(`free AI pictures: ${r.status}`);
  const result = await providerJson<{ result?: { image?: string } }>(r);
  if (!result.result?.image || result.result.image.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3)) throw new Error("AI image is missing or too large");
  return { data: Buffer.from(result.result.image, "base64"), source: "free_ai", credit: "Shubix picture", ref: "" };
}
async function paid(p: string): Promise<Picture> {
  if (paidAi() === "gemini") {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${cfg.geminiImageModel}:generateContent`, { method: "POST", headers: { "x-goog-api-key": cfg.geminiApiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: p }] }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "9:16" } } }), signal: AbortSignal.timeout(150_000) });
    if (!r.ok) throw new Error(`paid AI pictures: ${r.status}`);
    const result = await providerJson<{ candidates?: { content?: { parts?: { inlineData?: { data: string } }[] } }[] }>(r);
    const part = result.candidates?.[0]?.content?.parts?.find((x) => x.inlineData);
    if (!part?.inlineData?.data || part.inlineData.data.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3)) throw new Error("paid AI pictures: missing or oversized picture");
    return { data: Buffer.from(part.inlineData.data, "base64"), source: "paid_ai", credit: "Shubix HD picture", ref: "" };
  }
  const r = await fetch("https://api.openai.com/v1/images/generations", { method: "POST", headers: { Authorization: `Bearer ${cfg.openaiApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: cfg.openaiImageModel, prompt: p, size: "1024x1536", quality: "medium", n: 1 }), signal: AbortSignal.timeout(150_000) });
  if (!r.ok) throw new Error(`paid AI pictures: ${r.status}`);
  const result = await providerJson<{ data?: { b64_json?: string }[] }>(r);
  const encoded = result.data?.[0]?.b64_json;
  if (!encoded || encoded.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3)) throw new Error("paid AI pictures: missing or oversized picture");
  return { data: Buffer.from(encoded, "base64"), source: "paid_ai", credit: "Shubix HD picture", ref: "" };
}

/** The picture for one scene, as a 1080×1920 JPEG (the interesting part kept); AI pictures use credits. */
export async function scenePicture(o: { scene: Scene; style: string; characters: { name: string; look: string }[]; skip: string[]; reelId: string; i: number; ai?: boolean }) {
  const style = styleOf(o.style), skip = new Set(o.skip), errors: string[] = [];
  let pic: Picture | null = null, generationChargeRef: string | undefined;
  if (style.commons) {
    try { pic = await commons(o.scene, style.commons, skip); } catch (e) { errors.push(`Commons: ${(e as Error).message}`); }
  }
  if (!pic && o.ai !== false) { // AI pictures are Shubix AI: Editor and Pro (Free: the free paintings and photos)
    const p = promptFor(o.scene, style, o.characters);
    for (const [ok, make, cost] of [[freeAi, flux, "ai_picture"], [() => !!paidAi(), paid, "paid_picture"]] as const) {
      if (!ok()) continue;
      try {
        const sceneKey = crypto.createHash("sha256").update(p).digest("hex").slice(0, 24);
        const charge = await chargeOnce(cost, `story:${o.reelId}:${o.i}:${sceneKey}`, `Story Maker picture (scene ${o.i + 1})`);
        try { pic = await make(p); if (charge.taken && charge.ref) generationChargeRef = charge.ref; break; }
        catch (error) { if (charge.taken && charge.ref) await refund(charge.ref); throw error; }
      } catch (e) { if (e instanceof AppError) throw e; errors.push((e as Error).message); }
    }
  }
  // a general painting or photo of the scene's main word is better than nothing
  if (!pic && style.commons && o.scene.keywords.length > 1) {
    try { pic = await commons({ ...o.scene, keywords: o.scene.keywords.slice(0, 1) }, style.commons, skip); } catch { /* the message below */ }
  }
  if (!pic) throw new AppError(freeAi() || paidAi() ? `No picture for scene ${o.i + 1} right now. Try again, or add your own photos. ${errors.join(" · ").slice(0, 200)}`
    : `No free picture fits scene ${o.i + 1}. Add your own photos, choose “Classical painting”, or ask the admin to connect AI pictures.`, { code: "STORY_NO_PICTURE", status: 422 });
  try {
    if (!pic.data.length || pic.data.length > MAX_IMAGE_BYTES) throw new AppError("The selected picture is too large.", { code: "STORY_IMAGE_TOO_LARGE", status: 422 });
    const meta = await sharp(pic.data, { limitInputPixels: 40_000_000, failOn: "error" }).metadata();
    if (!["jpeg", "png", "webp", "avif"].includes(meta.format || "") || !meta.width || !meta.height || meta.width * meta.height > 40_000_000) throw new AppError("The selected picture format is not supported.", { code: "STORY_IMAGE_INVALID", status: 422 });
    const jpg = await sharp(pic.data, { limitInputPixels: 40_000_000, failOn: "error" }).rotate().resize(1080, 1920, { fit: "cover", position: sharp.strategy.attention }).jpeg({ quality: 84 }).toBuffer();
    return { image: `data:image/jpeg;base64,${jpg.toString("base64")}`, source: pic.source, credit: pic.credit, ref: pic.ref };
  } catch (error) {
    if (generationChargeRef) await refund(generationChargeRef);
    throw error;
  }
}
