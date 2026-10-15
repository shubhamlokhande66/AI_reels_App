import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { startDirectVideos, startSchema } from "@/server/projects/directUpload";

/** Start uploading clips straight to storage: presigned part URLs for each ({ direct: false } = use the normal upload). */
export const POST = route<{ projectId: string }>(async (req, { projectId }) => startDirectVideos(projectId, (await body(req, startSchema)).files));
