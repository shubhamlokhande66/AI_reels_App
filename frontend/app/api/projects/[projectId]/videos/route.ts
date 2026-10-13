import { route } from "@/server/core/http";
import { uploadVideos } from "@/server/projects/media";

/** Clips added to the project, streamed to disk (each probed, with a thumbnail). */
export const POST = route<{ projectId: string }>(async (req, { projectId }) => Response.json(await uploadVideos(projectId, req), { status: 201 }));
