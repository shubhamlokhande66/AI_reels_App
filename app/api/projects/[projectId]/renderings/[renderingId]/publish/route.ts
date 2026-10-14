import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { publish } from "@/server/publish";

export const POST = route<{ projectId: string; renderingId: string }>(async (req, { projectId, renderingId }) => {
  const p = await body(req, z.object({ platforms: z.array(z.enum(["instagram", "tiktok", "youtube"])).min(1).max(3), caption: z.string().max(2200).default(""), at: z.coerce.date().nullable().default(null) }));
  return Response.json(await publish(projectId, renderingId, p), { status: 202 });
});
