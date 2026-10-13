import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { revise } from "@/server/revise";

/** Change a finished Reel with words: "make it calmer, remove the first clip, add captions" -> a new version. */
export const POST = route<{ projectId: string }>(async (req, { projectId }) =>
  revise(projectId, await body(req, z.object({
    instruction: z.string().min(2).max(3000), useAi: z.boolean().default(true), dryRun: z.boolean().default(false),
    confirmedActions: z.array(z.record(z.string(), z.unknown())).max(30).nullable().default(null),
  }))));
