import { requireFeature } from "@/server/core/features";
import { flag } from "@/server/core/body";
import { route } from "@/server/core/http";
import { startManual } from "@/server/timeline/service";

/** The manual editor: open the edit, or (none yet / ?fresh=true) start one from the uploaded clips. */
export const POST = route<{ projectId: string }>(async (req, { projectId }) => {
  await requireFeature(req, "editor");
  return startManual(projectId, flag(req, "fresh"));
});
