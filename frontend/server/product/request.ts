import "server-only";
import { z } from "zod";
import { ValidationFailed } from "@/server/core/errors";

/** Changes for one product direction / render; anything left out keeps the project's own setting. */
const ProductRequest = z.object({
  productStyle: z.string().nullish(), hookText: z.string().max(80).nullish(), taglineText: z.string().max(80).nullish(), ctaText: z.string().max(80).nullish(), loop: z.boolean().nullish(),
  duration: z.number().int().min(5).max(600).nullish(), audioStart: z.number().min(0).max(36000).nullish(), audioAuto: z.boolean().default(false),
  seed: z.number().int().min(0).max(10_000_000).nullish(), quality: z.enum(["preview", "final"]).default("final"), label: z.string().max(60).nullish(),
});
/** The optional body (an empty body = all defaults). */
export async function productBody(req: Request) {
  const text = await req.text();
  let raw: unknown = {};
  if (text.trim()) { try { raw = JSON.parse(text); } catch { throw new ValidationFailed("Request validation failed.", { details: [{ loc: ["body"], msg: "Invalid JSON" }] }); } }
  const p = ProductRequest.safeParse(raw ?? {});
  if (!p.success) throw new ValidationFailed("Request validation failed.", { details: p.error.issues.map((i) => ({ loc: ["body", ...i.path], msg: i.message })) });
  const d = p.data;
  return { ...d, overrides: { productStyle: d.productStyle, hookText: d.hookText, taglineText: d.taglineText, ctaText: d.ctaText, loop: d.loop, duration: d.duration, audioStart: d.audioStart } };
}
