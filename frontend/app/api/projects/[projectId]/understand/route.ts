import { route } from "@/server/core/http";
import { GenerateRequest, submit } from "@/server/jobs/manager";
import { jobOut } from "@/server/projects/service";

/** What is IN each clip (vision model; cached per clip), as an analysis job with AI on. */
export const POST = route<{ projectId: string }>(async (_req, { projectId }) => Response.json(jobOut(await submit(projectId, "analyze", GenerateRequest.parse({ ai: true }))), { status: 202 }));
