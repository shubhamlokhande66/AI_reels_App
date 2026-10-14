import { route } from "@/server/core/http";
import { jobDoc } from "@/server/jobs/manager";
import { jobOut } from "@/server/projects/service";

export const GET = route<{ projectId: string; jobId: string }>(async (_req, { projectId, jobId }) => jobOut(await jobDoc(jobId, projectId)));
