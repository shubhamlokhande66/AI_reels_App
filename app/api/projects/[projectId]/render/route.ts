import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { submitRender } from "@/server/jobs/manager";
import { jobOut } from "@/server/projects/service";

const RenderRequest = z.object({ quality: z.string().default("final"), label: z.string().max(60).nullable().default(null) });

/** Render the project's current (edited) timeline: "preview" is small and quick, "final" full size. */
export const POST = route<{ projectId: string }>(async (req, { projectId }) => {
  const p = req.headers.get("content-length") === "0" ? RenderRequest.parse({}) : await body(req, RenderRequest.prefault({}));
  return Response.json(jobOut(await submitRender(projectId, p.quality, p.label ?? "")), { status: 202 });
});
