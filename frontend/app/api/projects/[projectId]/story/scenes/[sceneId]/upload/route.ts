import fs from "node:fs";
import { ValidationFailed } from "@/server/core/errors";
import { route } from "@/server/core/http";
import { readUpload } from "@/server/media/upload";
import { getProjectDoc } from "@/server/projects/service";
import { getStory, storyOut, uploadScenePicture } from "@/server/story";

export const POST = route<{ projectId: string; sceneId: string }>(async (req, { projectId, sceneId }) => {
  const doc0 = await getProjectDoc(projectId), up = await readUpload(req, 15 * 1024 * 1024, 1);
  try {
    const f = up.files.find((x) => x.field === "file");
    if (!f) throw new ValidationFailed("Request validation failed.", { details: [{ loc: ["body", "file"], msg: "Field required" }] });
    if (f.tooLarge) throw new ValidationFailed("The picture is larger than 15 MB.", { code: "IMAGE_TOO_LARGE" });
    await uploadScenePicture(doc0, sceneId, fs.readFileSync(f.tmp));
  } finally { up.cleanup(); }
  const doc = await getProjectDoc(projectId);
  return storyOut(doc, getStory(doc));
});
