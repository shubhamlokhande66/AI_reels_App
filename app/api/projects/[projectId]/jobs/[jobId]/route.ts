import { route } from "@/server/core/http";
import { jobDoc, queuePosition } from "@/server/jobs/manager";
import { jobOut } from "@/server/projects/service";

/** The job, with its place in the queue while it waits (1 = next). */
export const GET = route<{ projectId: string; jobId: string }>(async (_req, { projectId, jobId }) => {
  const doc = await jobDoc(jobId, projectId);
  return { ...jobOut(doc), queuePosition: await queuePosition(doc) };
});
