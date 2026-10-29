import type { ObjectId } from "mongodb";
import { db } from "./core/db";
import { ValidationFailed } from "./core/errors";
import { ICON_CHOICES, LISTS, TONE_CHOICES, type Content, type ListItem } from "@shubix/core/lib/collections";

/** The administrator's lists (Admin → CMS: Home's cards, tips, questions…), saved in app_settings. Only the lists the
 * administrator saved are kept; the app shows lib/collections.ts for the others. Cached for a few seconds. */
const ID = "content" as unknown as ObjectId;
let cache: { at: number; value: Content } | null = null;

export async function getContent(): Promise<Content> {
  if (cache && Date.now() - cache.at < 5000) return cache.value;
  const saved = ((await (await db()).collection("app_settings").findOne({ _id: ID })) ?? {}) as { lists?: Content };
  const value: Content = {};
  for (const l of LISTS) if (Array.isArray(saved.lists?.[l.id])) value[l.id] = saved.lists![l.id];
  cache = { at: Date.now(), value };
  return value;
}

const safeLink = (v: string) => /^(\/(?!\/)|https:\/\/|mailto:|tel:)/.test(v);

/** Admin: { "home.cards": [ … ] } saves a list, { "home.cards": null } puts its first items back. */
export async function setContent(patch: Record<string, unknown[] | null>): Promise<Content> {
  const cur = { ...(await getContent()) };
  for (const [id, items] of Object.entries(patch)) {
    const l = LISTS.find((x) => x.id === id);
    if (!l) throw new ValidationFailed(`Unknown list "${id}".`, { code: "INVALID_CONTENT" });
    if (items === null) { delete cur[id]; continue; }
    if (items.length > l.max) throw new ValidationFailed(`${l.name}: at most ${l.max}.`, { code: "INVALID_CONTENT" });
    cur[id] = items.map((raw, i) => {
      const r = (raw ?? {}) as Record<string, unknown>, it: ListItem = { id: String(r.id ?? "").slice(0, 40) || `i${i}` };
      for (const f of l.fields) {
        const v = typeof r[f.key] === "string" ? (r[f.key] as string).trim().slice(0, f.type === "long" ? 3000 : 300) : "";
        if (f.required && !v) throw new ValidationFailed(`${l.name} ${i + 1}: ${f.label} is needed.`, { code: "INVALID_CONTENT" });
        if (v && f.type === "link" && !safeLink(v)) throw new ValidationFailed(`${l.name} ${i + 1}: a link starts with /, https://, mailto: or tel:.`, { code: "INVALID_CONTENT" });
        if (v && f.type === "icon" && !ICON_CHOICES.includes(v)) throw new ValidationFailed(`${l.name} ${i + 1}: unknown icon.`, { code: "INVALID_CONTENT" });
        if (v && f.type === "tone" && !TONE_CHOICES.includes(v)) throw new ValidationFailed(`${l.name} ${i + 1}: unknown colour.`, { code: "INVALID_CONTENT" });
        if (v && f.type === "color" && !/^#[0-9a-f]{6}$/i.test(v)) throw new ValidationFailed(`${l.name} ${i + 1}: a colour is #rrggbb.`, { code: "INVALID_CONTENT" });
        it[f.key] = v;
      }
      return it;
    });
  }
  await (await db()).collection("app_settings").updateOne({ _id: ID }, { $set: { lists: cur, updatedAt: new Date() } }, { upsert: true });
  cache = null;
  return getContent();
}
