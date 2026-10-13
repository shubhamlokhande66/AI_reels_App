import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { getProjectDoc } from "@/server/projects/service";
import { editPlan, getStory, saveStory, storyOut } from "@/server/story";

export const GET = route<{ projectId: string }>(async (_req, { projectId }) => { const doc = await getProjectDoc(projectId); return storyOut(doc, getStory(doc)); });
export const PUT = route<{ projectId: string }>(async (req, { projectId }) => {
  const p = await body(req, z.object({ title: z.string().max(120).default(""), scenes: z.array(z.object({ id: z.string().default(""), narration: z.string().max(600), visual: z.string().max(700).default("") })).min(2).max(14) }));
  const doc = await getProjectDoc(projectId), plan = editPlan(getStory(doc), p.title, p.scenes);
  await saveStory(doc._id, plan);
  return storyOut(doc, plan);
});
