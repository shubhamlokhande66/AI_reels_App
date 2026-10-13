import { route, toPython } from "@/server/core/http";
import { ValidationFailed } from "@/server/core/errors";
import { listProjects } from "@/server/projects/service";

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

// not moved yet: creating a project (needs the settings rules) - see docs/MIGRATION.md
export const POST = toPython;
