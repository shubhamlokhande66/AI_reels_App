import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { ProjectUpdate } from "@/server/projects/settings";
import { deleteProject, getProjectDoc, projectOut, updateProject } from "@/server/projects/service";

/** One project, with its clips, song, latest Reel and job. */
export const GET = route<{ projectId: string }>(async (_req, { projectId }) => projectOut(await getProjectDoc(projectId)));

export const DELETE = route<{ projectId: string }>(async (_req, { projectId }) => {
  await deleteProject(projectId);
});

/** Change the name and / or settings (only the fields sent). */
export const PATCH = route<{ projectId: string }>(async (req, { projectId }) => projectOut(await updateProject(projectId, await body(req, ProjectUpdate))));
