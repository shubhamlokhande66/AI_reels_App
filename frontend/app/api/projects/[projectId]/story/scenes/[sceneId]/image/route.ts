import fs from "node:fs";
import { NotFoundError } from "@/server/core/errors";
import { route, sendFile } from "@/server/core/http";
import { getProjectDoc } from "@/server/projects/service";
import { localPath } from "@/server/storage/local";
import { getStory, sceneOf } from "@/server/story";

export const GET = route<{ projectId: string; sceneId: string }>(async (req, { projectId, sceneId }) => {
  const scene = sceneOf(getStory(await getProjectDoc(projectId)), sceneId), file = scene.image_key ? localPath(scene.image_key) : null;
  if (!file || !fs.existsSync(file)) throw new NotFoundError("This scene has no picture yet.", { code: "SCENE_NO_PICTURE" });
  return sendFile(req, file, file.endsWith(".png") ? "image/png" : "image/jpeg");
});
