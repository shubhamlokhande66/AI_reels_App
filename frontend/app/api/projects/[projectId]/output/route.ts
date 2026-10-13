import { db } from "@/server/core/db";
import { NotFoundError } from "@/server/core/errors";
import { route } from "@/server/core/http";
import { getProjectDoc, renderingOut } from "@/server/projects/service";

/** The project's latest final Reel. */
export const GET = route<{ projectId: string }>(async (_req, { projectId }) => {
  const doc = await getProjectDoc(projectId);
  const r = doc.latestRenderingId ? await (await db()).collection("renderings").findOne({ _id: doc.latestRenderingId }) : null;
  if (!r) throw new NotFoundError("No Reel has been generated for this project yet.", { code: "NO_OUTPUT" });
  return renderingOut(r);
});
