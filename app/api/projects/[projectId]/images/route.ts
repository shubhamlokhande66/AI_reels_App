import { route } from "@/server/core/http";
import { uploadImages } from "@/server/projects/media";

/** Product photos (decoded to check them, turned upright, with thumbnails). */
export const POST = route<{ projectId: string }>(async (req, { projectId }) => Response.json(await uploadImages(projectId, req), { status: 201 }));
