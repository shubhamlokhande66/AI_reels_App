import { route } from "@/server/core/http";
import { deleteImage } from "@/server/projects/media";

export const DELETE = route<{ projectId: string; mediaId: string }>(async (_req, { projectId, mediaId }) => {
  await deleteImage(projectId, mediaId);
});
