import { route, toPython } from "@/server/core/http";
import { deleteProject, getProjectDoc, projectOut } from "@/server/projects/service";

/** One project, with its clips, song, latest Reel and job. */
export const GET = route<{ projectId: string }>(async (_req, { projectId }) => projectOut(await getProjectDoc(projectId)));

export const DELETE = route<{ projectId: string }>(async (_req, { projectId }) => {
  await deleteProject(projectId);
});

// not moved yet: changing settings (needs the settings rules) - see docs/MIGRATION.md
export const PATCH = toPython;
