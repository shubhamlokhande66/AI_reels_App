import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { createProject } from "@/server/projects/service";
import { ProjectSettings } from "@/server/projects/settings";
import { MAX_SCENES, MIN_SCENES, planStory, saveStory, storyOut } from "@/server/story";

/** Plan the story into scenes (one AI call; without AI, by sentence) and make it a project. */
export const POST = route(async (req) => {
  const p = await body(req, z.object({ text: z.string().min(40).max(12000), language: z.enum(["en", "hi", "mr", "hinglish"]).default("hi"), artStyle: z.string().default("ravi_varma"),
    scenes: z.number().int().min(MIN_SCENES).max(MAX_SCENES).default(8), seconds: z.number().int().min(20).max(180).default(60) }));
  const plan = await planStory(p.text, p.language, p.artStyle, p.scenes, p.seconds);
  const doc = await createProject(plan.title.slice(0, 120) || "Story", ProjectSettings.parse({ reelType: "story", language: p.language, duration: Math.min(Math.max(p.seconds, 5), 600) }));
  await saveStory(doc._id, plan);
  return Response.json(storyOut(doc, plan), { status: 201 });
});
