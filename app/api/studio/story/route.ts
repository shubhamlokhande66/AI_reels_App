import { z } from "zod";
import { isPlanAdmin } from "@/server/core/admin";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { limits } from "@/server/core/rateLimit";
import { requirePlanItem } from "@/server/planLocks";
import { aiAllowed } from "@/server/credits";
import { ART_STYLES, planStory, storyOptions } from "@/server/studio/story";

/** Story Maker: the picture styles this studio has (the AI-only ones need AI pictures connected). */
export const GET = route(async (req) => storyOptions((await aiAllowed(await isPlanAdmin(req))).ok));

/** Story Maker from words alone: the story's sentences in scenes, each with what its picture shows. */
export const POST = route(async (req) => {
  const admin = await isPlanAdmin(req);
  await requirePlanItem("page:story", admin);
  limits.ai(req);
  const p = await body(req, z.object({ sentences: z.array(z.string().max(600)).min(1).max(80), style: z.enum(ART_STYLES.map((s) => s.id) as [string, ...string[]]) }));
  return planStory(p.sentences, p.style, (await aiAllowed(admin)).ok); // Shubix AI plans the scenes on Editor and Pro only
});
