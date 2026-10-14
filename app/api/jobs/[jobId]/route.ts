import { route } from "@/server/core/http";
import { jobDoc } from "@/server/jobs/manager";
import { jobOut } from "@/server/projects/service";

export const GET = route<{ jobId: string }>(async (_req, { jobId }) => jobOut(await jobDoc(jobId)));
