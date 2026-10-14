import { route } from "@/server/core/http";
import { body } from "@/server/core/body";
import { GenerateRequest, submit } from "@/server/jobs/manager";
import { jobOut } from "@/server/projects/service";

/** Make the Reel (a background job); the body may override settings for this one generation. */
export const POST = route<{ projectId: string }>(async (req, { projectId }) => {
  const payload = req.headers.get("content-length") === "0" ? GenerateRequest.parse({}) : await body(req, GenerateRequest.prefault({}));
  return Response.json(jobOut(await submit(projectId, "generate", payload)), { status: 202 });
});
