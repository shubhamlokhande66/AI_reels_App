import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { ValidationFailed } from "@/server/core/errors";
import { ProjectCreate } from "@/server/projects/settings";
import { createProject, listProjects, projectOut } from "@/server/projects/service";

const STATUSES = new Set(["draft", "processing", "completed", "failed"]);

/** The projects, newest change first. */
export const GET = route(async (req) => {
  const q = new URL(req.url).searchParams;
  const status = q.get("status");
  const limit = Number(q.get("limit") ?? 100);
  if (status && !STATUSES.has(status)) throw new ValidationFailed("Request validation failed.", { details: [{ loc: ["query", "status"], msg: "unknown status" }] });
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new ValidationFailed("Request validation failed.", { details: [{ loc: ["query", "limit"], msg: "1 to 200" }] });
  return listProjects(status, limit);
});

/** A new project (201) with its settings checked: style, export preset and trend must exist. */
export const POST = route(async (req) => {
  const p = await body(req, ProjectCreate);
  return Response.json(await projectOut(await createProject(p.name, p.settings)), { status: 201 });
});
