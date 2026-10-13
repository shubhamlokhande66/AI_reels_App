import { db } from "@/server/core/db";
import { route } from "@/server/core/http";
import { getProjectDoc, jobOut } from "@/server/projects/service";

/** The project's latest jobs, newest first. */
export const GET = route<{ projectId: string }>(async (req, { projectId }) => {
  const limit = Math.min(Math.max(Number(new URL(req.url).searchParams.get("limit") ?? 20) || 20, 1), 100);
  const doc = await getProjectDoc(projectId);
  return (await (await db()).collection("jobs").find({ projectId: doc._id }).sort({ createdAt: -1 }).limit(limit).toArray()).map(jobOut);
});
