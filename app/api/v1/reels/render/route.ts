import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { renderPlan } from "@/server/ai/aiTimeline";

const Req = z.object({ projectId: z.string(), planId: z.string().nullable().default(null), timeline: z.array(z.record(z.string(), z.unknown())).nullable().default(null), quality: z.enum(["final", "preview"]).default("final"), minClip: z.number().min(0.25).max(2).default(0.4) });

/** Check the plan again and render it in the background; poll /api/v1/reels/{reel_id}/status. */
export const POST = route(async (req) => {
  const p = await body(req, Req);
  return Response.json(await renderPlan(p.projectId, p.planId, p.timeline, p.quality, p.minClip), { status: 202 });
});
