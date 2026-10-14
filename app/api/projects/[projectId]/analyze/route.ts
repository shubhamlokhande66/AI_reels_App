import { route } from "@/server/core/http";
import { submit } from "@/server/jobs/manager";
import { jobOut } from "@/server/projects/service";

/** Analyse the project's clips and song (a background job). */
export const POST = route<{ projectId: string }>(async (_req, { projectId }) => Response.json(jobOut(await submit(projectId, "analyze")), { status: 202 }));
