import { ValidationFailed } from "@/server/core/errors";
import { route } from "@/server/core/http";
import { getProjectDoc } from "@/server/projects/service";
import { getStory, MIN_SCENES, planStory, saveStory, storyOut } from "@/server/story";

/** Write the scenes again with the AI (pictures are reset). */
export const POST = route<{ projectId: string }>(async (_req, { projectId }) => {
  const doc = await getProjectDoc(projectId), old = getStory(doc);
  if (!old.source_text) throw new ValidationFailed("The original story text is not stored for this project.", { code: "STORY_NO_SOURCE" });
  const plan = await planStory(old.source_text, old.language, old.art_style, Math.max(old.scenes.length, MIN_SCENES), old.seconds);
  if (plan.planned_by !== "ai") throw new ValidationFailed("The AI is still busy. Try again in a minute; your scenes are unchanged.", { code: "AI_BUSY" });
  await saveStory(doc._id, plan);
  return storyOut(doc, plan);
});
