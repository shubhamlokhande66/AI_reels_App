import "server-only";
import type { ObjectId } from "mongodb";
import { z } from "zod";
import { db } from "@/server/core/db";
import { ValidationFailed } from "@/server/core/errors";
import {
  DEFAULT_TEMPLATES, edgeAt, liveTemplates, TPL_ANIMS, TPL_BGS, TPL_CAP_STYLES, TPL_LIMITS, TPL_LOOKS, TPL_MODES, TPL_MUSIC, TPL_PACES, TPL_TEXT_STYLES,
  type StudioTemplate,
} from "@/lib/studio-templates";

/** Fast Studio's templates: the administrator's list (app_settings "studio_templates"), or the defaults until one is saved. */
const ID = "studio_templates" as unknown as ObjectId;
const keys = <T extends object>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a day as YYYY-MM-DD").optional().or(z.literal("").transform(() => undefined));
const Edge = z.object({ p: z.number().min(0).max(1), s: z.number().min(-600).max(600).default(0) });
const Text = z.object({
  text: z.string().trim().min(1).max(TPL_LIMITS.line),
  style: z.enum(keys(TPL_TEXT_STYLES)),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "a colour as #RRGGBB"),
  anim: z.enum(keys(TPL_ANIMS)).optional(),
  y: z.number().min(0.03).max(0.97),
  size: z.number().min(0.3).max(3).optional(),
  all: z.boolean().optional(),
  from: Edge.optional(),
  to: Edge.optional(),
});
export const TemplateIn = z.object({
  id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "an id of small letters, digits and -"),
  name: z.string().trim().min(1).max(TPL_LIMITS.name),
  kind: z.enum(["music", "talk", "photo"]),
  len: z.number().int().min(5).max(180).optional(),
  text: z.string().trim().max(TPL_LIMITS.text).default(""),
  group: z.string().trim().min(1).max(30),
  cover: z.string().trim().max(500).regex(/^(\/|https:\/\/)/, "a /path or an https:// address").optional().or(z.literal("").transform(() => undefined)),
  on: z.boolean().default(true),
  showFrom: day,
  showTo: day,
  isNew: z.boolean().optional(),
  plan: z.enum(["free", "creator", "pro", "business"]).optional(),
  edit: z.object({
    look: z.enum(keys(TPL_LOOKS)),
    mode: z.enum(keys(TPL_MODES)).optional(),
    pace: z.enum(keys(TPL_PACES)).optional(),
    music: z.number().refine((v) => (TPL_MUSIC as readonly number[]).includes(v), "one of " + TPL_MUSIC.join(", ")).optional(),
    caps: z.boolean().optional(),
    style: z.enum(keys(TPL_CAP_STYLES)).optional(),
    bg: z.enum(keys(TPL_BGS)).optional(),
    hook: z.string().trim().max(TPL_LIMITS.line).optional(),
    texts: z.array(Text).max(TPL_LIMITS.texts).optional(),
  }),
});
export const TemplatesIn = z.object({ templates: z.array(TemplateIn).max(TPL_LIMITS.templates) });

/** every template (the administrator's view) */
export async function allTemplates(): Promise<{ templates: StudioTemplate[]; saved: boolean; updatedAt?: string }> {
  const doc = (await (await db()).collection("app_settings").findOne({ _id: ID })) as { templates?: StudioTemplate[]; updatedAt?: Date } | null;
  return doc?.templates ? { templates: doc.templates, saved: true, updatedAt: doc.updatedAt?.toISOString() } : { templates: DEFAULT_TEMPLATES, saved: false };
}
/** the ones people see today: on, inside their days, in the administrator's order */
export async function liveList() {
  return { templates: liveTemplates((await allTemplates()).templates) };
}
export async function saveTemplates(list: z.infer<typeof TemplatesIn>["templates"]) {
  const ids = new Set<string>();
  for (const t of list) {
    if (ids.has(t.id)) throw new ValidationFailed(`Two templates have the id "${t.id}".`, { code: "INVALID_TEMPLATES" });
    ids.add(t.id);
    if (t.showFrom && t.showTo && t.showFrom > t.showTo) throw new ValidationFailed(`"${t.name}": the first day is after the last.`, { code: "INVALID_TEMPLATES" });
    const L = t.len ?? 30;   // checked on the template's own length (30 s for talking Reels)
    for (const x of t.edit.texts ?? []) if (!x.all && edgeAt(x.from, L, 0) >= edgeAt(x.to, L, L))
      throw new ValidationFailed(`"${t.name}": the text "${x.text}" ends before it starts.`, { code: "INVALID_TEMPLATES" });
  }
  await (await db()).collection("app_settings").updateOne({ _id: ID }, { $set: { templates: list, updatedAt: new Date() } }, { upsert: true });
  return allTemplates();
}
/** back to the defaults */
export async function resetTemplates() {
  await (await db()).collection("app_settings").deleteOne({ _id: ID });
  return allTemplates();
}
