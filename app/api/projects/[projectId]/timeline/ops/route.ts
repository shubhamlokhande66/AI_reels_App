import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { Operation } from "@/server/timeline/ops";
import { apply } from "@/server/timeline/service";

const OpsRequest = z.object({ ops: z.array(Operation).min(1).max(50), label: z.string().max(80).nullable().default(null) });

/** One batch of edits, all-or-nothing, as one undoable step. */
export const POST = route<{ projectId: string }>(async (req, { projectId }) => {
  const p = await body(req, OpsRequest);
  return apply(projectId, p.ops, p.label);
});
