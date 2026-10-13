import { route } from "@/server/core/http";
import { uploadAudio } from "@/server/projects/media";

/** The project's song (replaces the previous one; joins the song library). */
export const POST = route<{ projectId: string }>(async (req, { projectId }) => Response.json(await uploadAudio(projectId, req), { status: 201 }));
