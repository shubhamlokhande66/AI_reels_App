import { db } from "@/server/core/db";
import { NotFoundError } from "@/server/core/errors";
import { route } from "@/server/core/http";
import { getProjectDoc, renderingOut } from "@/server/projects/service";

export const GET = route<{ projectId: string }>(async (_req, { projectId }) => {
  const doc = await getProjectDoc(projectId);
  const r = doc.previewRenderingId ? await (await db()).collection("renderings").findOne({ _id: doc.previewRenderingId }) : null;
  if (!r) throw new NotFoundError("No preview has been rendered yet.", { code: "NO_PREVIEW" });
  return renderingOut(r as never);
});
