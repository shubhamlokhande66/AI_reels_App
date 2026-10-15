import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { cancelDirectVideo, completeDirectVideo, completeSchema } from "@/server/projects/directUpload";

/** Every part is uploaded: join them into the clip and add it to the project. */
export const POST = route<{ projectId: string; mediaId: string }>(async (req, { projectId, mediaId }) =>
  Response.json(await completeDirectVideo(projectId, mediaId, (await body(req, completeSchema)).parts), { status: 201 }));

/** The browser gave up on this upload: its parts are discarded. */
export const DELETE = route<{ projectId: string; mediaId: string }>(async (_req, { projectId, mediaId }) => cancelDirectVideo(projectId, mediaId));
