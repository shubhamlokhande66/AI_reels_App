import { db } from "@/server/core/db";
import { route } from "@/server/core/http";
import { getProjectDoc, renderingOut } from "@/server/projects/service";

/** Every rendering of the project, newest first. */
export const GET = route<{ projectId: string }>(async (_req, { projectId }) => {
  const doc = await getProjectDoc(projectId);
  return (await (await db()).collection("renderings").find({ projectId: doc._id }).sort({ createdAt: -1 }).toArray()).map(renderingOut);
});
