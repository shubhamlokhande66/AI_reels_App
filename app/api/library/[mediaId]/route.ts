import { requireFeature } from "@/server/core/features";
import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { updateLibraryItem } from "@/server/brands";

export const PATCH = route<{ mediaId: string }>(async (req, { mediaId }) => {
  await requireFeature(req, "library");
  const p = await body(req, z.object({ favorite: z.boolean().nullable().default(null), tags: z.array(z.string()).max(30).nullable().default(null) }));
  return updateLibraryItem(mediaId, p.favorite, p.tags);
});
