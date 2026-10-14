import { parseId } from "@/server/core/db";
import { route } from "@/server/core/http";
import { allItems, applyFilters, search, tokenize, topTags } from "@/server/brands";

const bool = (v: string | null) => (v === null ? null : ["1", "true", "yes", "on"].includes(v.toLowerCase()));

/** Every clip across projects: search, tags, favourites, used / unused, analysed. */
export const GET = route(async (req) => {
  const q = new URL(req.url).searchParams;
  const project = q.get("project");
  let items = await allItems(project ? parseId(project, "Project") : null);
  const tags = topTags(items);
  items = applyFilters(items, { tag: q.get("tag"), category: q.get("category"), favorite: bool(q.get("favorite")), used: bool(q.get("used")), analyzed: bool(q.get("analyzed")) });
  if (q.get("q")) items = search(items, tokenize(q.get("q")!.slice(0, 200)));
  const limit = Math.min(Math.max(Number(q.get("limit") ?? 100) || 100, 1), 200);
  return { items: items.slice(0, limit), total: items.length, tags };
});
