import { z } from "zod";
import { isPlanAdmin } from "@/server/core/admin";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { limits } from "@/server/core/rateLimit";
import { requirePlanItem } from "@/server/planLocks";
import { aiAllowed } from "@/server/credits";
import { ART_STYLES, scenePicture } from "@/server/studio/story";

/** One scene's picture (a free painting or photo first; an AI picture uses credits), as a vertical JPEG. */
export const POST = route(async (req) => {
  const admin = await isPlanAdmin(req);
  await requirePlanItem("page:story", admin);
  limits.ai(req);
  const p = await body(req, z.object({
    scene: z.object({ text: z.string().max(4000), visual: z.string().max(600), keywords: z.array(z.string().max(60)).max(8) }),
    style: z.enum(ART_STYLES.map((s) => s.id) as [string, ...string[]]),
    characters: z.array(z.object({ name: z.string().max(80), look: z.string().max(300) })).max(8).default([]),
    skip: z.array(z.string().max(300)).max(40).default([]),
    reelId: z.string().max(80), i: z.number().int().min(0).max(40),
  }));
  return scenePicture({ ...p, ai: (await aiAllowed(admin)).ok }); // AI pictures on Editor and Pro only
});
