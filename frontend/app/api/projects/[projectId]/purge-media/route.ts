import { route } from "@/server/core/http";
import { getProjectDoc } from "@/server/projects/service";
import { purgeMedia } from "@/server/workspace";

/** Delete the project's uploaded media now (the finished Reels are kept). */
export const POST = route<{ projectId: string }>(async (_req, { projectId }) => ({ deleted: await purgeMedia((await getProjectDoc(projectId))._id) }));
