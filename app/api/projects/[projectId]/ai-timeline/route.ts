import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { makePlan } from "@/server/ai/aiTimeline";

const Req = z.object({ duration: z.number().min(3).max(600).nullable().default(null), start: z.number().min(0).max(36000).nullable().default(null), minClip: z.number().min(0.25).max(2).default(0.4), brief: z.string().max(600).nullable().default(null), refresh: z.boolean().default(false) });

/** The AI's editing timeline for the project (same as POST /api/v1/reels/plan). */
export const POST = route<{ projectId: string }>(async (req, { projectId }) => makePlan(projectId, await body(req, Req.prefault({}))));
