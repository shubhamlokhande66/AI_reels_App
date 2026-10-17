import { requireFeature } from "@/server/core/features";
import { route } from "@/server/core/http";
import { importFolders } from "@/server/songs/service";

/** Scan the watched folders right away. */
export const POST = route(async (req) => {
  await requireFeature(req, "songs");
  return importFolders(true);
});
