import { beatMap } from "@/server/audio/beatmap";
import { route } from "@/server/core/http";
import { projectSongAnalysis } from "@/server/services/music";

/** The song's full beat map: every major beat, beat and sub-beat, rises and falls, drops, parts and the plan. */
export const GET = route<{ projectId: string }>(async (_req, { projectId }) => beatMap((await projectSongAnalysis(projectId)).analysis));
