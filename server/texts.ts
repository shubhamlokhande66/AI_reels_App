import "server-only";
import type { ObjectId } from "mongodb";
import { db } from "@/server/core/db";
import { ValidationFailed } from "@/server/core/errors";
import { type Texts } from "@/lib/texts";
import { ALL_TEXT_DEFAULTS as TEXT_DEFAULTS } from "@/lib/texts-all";

/** The administrator's texts (Admin → CMS) over the defaults (lib/texts.ts), saved in app_settings. Cached
 * for a few seconds: every page reads them. */
const ID = "texts" as unknown as ObjectId;
let cache: { at: number; value: Texts } | null = null;

/** only the texts the administrator changed (the app adds the defaults) */
export async function getTexts(): Promise<Texts> {
  if (cache && Date.now() - cache.at < 5000) return cache.value;
  const saved = ((await (await db()).collection("app_settings").findOne({ _id: ID })) ?? {}) as { texts?: Record<string, unknown> };
  const value: Texts = {};
  for (const [k, v] of Object.entries(saved.texts ?? {})) if (k in TEXT_DEFAULTS && typeof v === "string") value[k] = v;
  cache = { at: Date.now(), value };
  return value;
}

/** Admin: { key: "new text" } changes a text, { key: null } puts its default back. */
export async function setTexts(patch: Record<string, string | null>): Promise<Texts> {
  const cur = { ...(await getTexts()) };
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in TEXT_DEFAULTS)) throw new ValidationFailed(`Unknown text "${k}".`, { code: "INVALID_TEXT" });
    if (v === null || v === TEXT_DEFAULTS[k]) delete cur[k];
    else cur[k] = v.slice(0, 2000);
  }
  await (await db()).collection("app_settings").updateOne({ _id: ID }, { $set: { texts: cur, updatedAt: new Date() } }, { upsert: true });
  cache = null;
  return getTexts();
}
