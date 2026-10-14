import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { getProjectDoc } from "@/server/projects/service";
import { findScenePicture, getStory, storyOut } from "@/server/story";

/** A picture for one scene: the library, a public-domain painting, then AI; another = a different one. */
export const POST = route<{ projectId: string; sceneId: string }>(async (req, { projectId, sceneId }) => {
  const p = await body(req, z.object({ another: z.boolean().default(false) }));
  await findScenePicture(await getProjectDoc(projectId), sceneId, p.another);
  const doc = await getProjectDoc(projectId);
  return storyOut(doc, getStory(doc));
});
