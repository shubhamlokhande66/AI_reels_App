import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { DuplicateRequest, duplicateProject } from "@/server/workspace";

/** Copy a project with its media, so another language or format needs no re-upload. */
export const POST = route<{ projectId: string }>(async (req, { projectId }) => {
  const p = req.headers.get("content-length") === "0" ? DuplicateRequest.parse({}) : await body(req, DuplicateRequest.prefault({}));
  return Response.json(await duplicateProject(projectId, p), { status: 201 });
});
