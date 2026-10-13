import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { makePlan } from "@/server/ai/aiTimeline";

const Req = z.object({ projectId: z.string(), duration: z.number().min(3).max(600).nullable().default(null), start: z.number().min(0).max(36000).nullable().default(null), minClip: z.number().min(0.25).max(2).default(0.4), brief: z.string().max(600).nullable().default(null), refresh: z.boolean().default(false) });

/** The song and clip analysis to the AI configured in Settings: the complete editing timeline, checked and saved as plan_id. */
export const POST = route(async (req) => { const p = await body(req, Req); return makePlan(p.projectId, p); });
