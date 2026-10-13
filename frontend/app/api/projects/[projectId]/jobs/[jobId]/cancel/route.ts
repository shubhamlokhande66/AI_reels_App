import { ConflictError } from "@/server/core/errors";
import { route } from "@/server/core/http";
import { jobDoc, requestCancel } from "@/server/jobs/manager";
import { jobOut } from "@/server/projects/service";

/** Ask a running / queued job to stop; it stops at its next progress tick (keep polling the job). */
export const POST = route<{ projectId: string; jobId: string }>(async (_req, { projectId, jobId }) => {
  const doc = await jobDoc(jobId, projectId);
  if (!["queued", "processing"].includes(doc.status as string)) throw new ConflictError("This job has already finished, so there is nothing to cancel.", { code: "JOB_NOT_ACTIVE" });
  if (!requestCancel(jobId)) throw new ConflictError("This job can no longer be cancelled from here (the server may have restarted since it started).", { code: "JOB_NOT_CANCELLABLE" });
  return Response.json(jobOut(await jobDoc(jobId, projectId)), { status: 202 });
});
