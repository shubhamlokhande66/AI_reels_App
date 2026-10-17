import { requireFeature } from "@/server/core/features";
import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { aiTerms, allItems, search } from "@/server/brands";

/** Natural-language search: the AI adds synonyms; without AI it is keyword search. */
export const POST = route(async (req) => {
  await requireFeature(req, "library");
  const p = await body(req, z.object({ query: z.string().min(1).max(200), ai: z.boolean().default(false), limit: z.number().int().min(1).max(200).default(50) }));
  const [terms, note, ai] = await aiTerms(p.ai, p.query);
  const items = search(await allItems(), terms);
  return { items: items.slice(0, p.limit), total: items.length, terms, note, ai };
});
