import "server-only";
import fs from "node:fs";
import path from "node:path";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { db, parseId } from "@/server/core/db";
import { NotFoundError, UnsupportedMedia, ValidationFailed } from "@/server/core/errors";
import { readUpload } from "@/server/media/upload";
import { deletePrefix, localPath } from "@/server/storage/local";

/** Brand kits: name, colours, fonts, watermark logo and the defaults a Reel made for the brand starts with. */

type Doc = Record<string, unknown> & { _id: ObjectId };
const HEX = /^#[0-9A-Fa-f]{6}$/, MAX_LOGO_BYTES = 5 * 1024 * 1024, LOGO_EXTS = [".png", ".jpg", ".jpeg", ".webp"];

export const BrandIn = z.object({
  name: z.string().min(1).max(80),
  colors: z.object({ primary: z.string().regex(HEX).default("#FFFFFF"), secondary: z.string().regex(HEX).default("#000000"), accent: z.string().regex(HEX).default("#8B5CF6") }).prefault({}),
  captionFont: z.string().max(60).nullable().default(null), headingFont: z.string().max(60).nullable().default(null),
  watermark: z.object({ enabled: z.boolean().default(true), position: z.enum(["br", "bl", "tr", "tl", "center"]).default("br"), opacity: z.number().min(0.05).max(1).default(0.85), scale: z.number().min(0.04).max(0.6).default(0.16) }).prefault({}),
  cta: z.string().max(100).default(""), language: z.enum(["en", "hi", "mr", "hinglish"]).default("en"), voiceProfileId: z.string().nullable().default(null), scriptTone: z.string().max(80).default(""),
  captionStyle: z.enum(["minimal", "bold", "karaoke", "highlight", "luxury"]).default("minimal"), style: z.string().default("auto"),
  visualStyle: z.enum(["luxury", "cinematic", "viral", "minimal", "energetic", "storytelling", "product_focus", "social_native"]).nullable().default(null),
  pace: z.enum(["auto", "calm", "balanced", "fast"]).default("balanced"), trendId: z.string().nullable().default(null), musicStyle: z.string().max(100).default(""), exportPreset: z.string().default("instagram_reel"),
});
type BrandIn = z.infer<typeof BrandIn>;
const KEYS = ["name", "colors", "captionFont", "headingFont", "watermark", "cta", "language", "voiceProfileId", "scriptTone", "captionStyle", "style", "visualStyle", "pace", "trendId", "musicStyle", "exportPreset"];
export const brandOut = (d: Doc) => ({ id: String(d._id), ...Object.fromEntries(KEYS.map((k) => [k, d[k] ?? null])), hasLogo: Boolean(d.logoKey), logoUrl: d.logoKey ? `/api/brands/${d._id}/logo` : null, createdAt: d.createdAt ?? null });
const brands = async () => (await db()).collection("brands");
async function brandDoc(id: string): Promise<Doc> {
  const d = await (await brands()).findOne({ _id: parseId(id, "Brand") });
  if (!d) throw new NotFoundError("Brand not found.", { code: "BRAND_NOT_FOUND" });
  return d as Doc;
}

export const listBrands = async () => (await (await brands()).find({}).sort({ createdAt: -1 }).toArray()).map((d) => brandOut(d as Doc));
export async function createBrand(p: BrandIn) {
  const doc = { _id: new ObjectId(), ...p, logoKey: null, createdAt: new Date() };
  await (await brands()).insertOne(doc);
  return brandOut(doc);
}
export const getBrand = async (id: string) => brandOut(await brandDoc(id));
export async function updateBrand(id: string, p: BrandIn) {
  const d = await brandDoc(id);
  await (await brands()).updateOne({ _id: d._id }, { $set: p });
  return getBrand(id);
}
export async function deleteBrand(id: string) {
  const oid = parseId(id, "Brand");
  deletePrefix(`brands/${oid}`);
  await (await brands()).deleteOne({ _id: oid });
}

export async function uploadLogo(id: string, req: Request) {
  const d = await brandDoc(id);
  const up = await readUpload(req, MAX_LOGO_BYTES, 1);
  try {
    const f = up.files[0];
    if (!f) throw new ValidationFailed("Request validation failed.", { details: [{ loc: ["body", "file"], msg: "Field required" }] });
    if (!LOGO_EXTS.some((e) => (f.filename ?? "").toLowerCase().endsWith(e))) throw new UnsupportedMedia("The logo must be a PNG, JPG or WEBP image.", { details: { allowed: [...LOGO_EXTS].sort() } });
    if (f.tooLarge) throw new ValidationFailed("The logo is larger than 5 MB.", { code: "FILE_TOO_LARGE" });
    const sharp = (await import("sharp")).default;
    let png: Buffer;
    try {
      const img = sharp(f.tmp, { failOn: "error" }), meta = await img.metadata();
      if (!meta.width || !meta.height || Math.min(meta.width, meta.height) < 16) throw new Error("too small");
      png = await img.resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true }).png().toBuffer();
    } catch { throw new UnsupportedMedia("That file is not a usable image.", { code: "INVALID_IMAGE" }); }
    const key = `brands/${d._id}/logo.png`;
    fs.mkdirSync(path.dirname(localPath(key)), { recursive: true });
    fs.writeFileSync(localPath(key), png);
    await (await brands()).updateOne({ _id: d._id }, { $set: { logoKey: key } });
    return getBrand(id);
  } finally {
    up.cleanup();
  }
}
export async function logoFile(id: string): Promise<string> {
  const d = await (await brands()).findOne({ _id: parseId(id, "Brand") });
  if (!d?.logoKey || !fs.existsSync(localPath(d.logoKey as string))) throw new NotFoundError("This brand has no logo.", { code: "LOGO_NOT_FOUND" });
  return localPath(d.logoKey as string);
}
