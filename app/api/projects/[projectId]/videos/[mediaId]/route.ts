import { route } from "@/server/core/http";
import { deleteVideo } from "@/server/projects/media";

export const DELETE = route<{ projectId: string; mediaId: string }>(async (_req, { projectId, mediaId }) => {
  await deleteVideo(projectId, mediaId);
});
