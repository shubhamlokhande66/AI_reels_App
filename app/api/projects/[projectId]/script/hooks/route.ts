import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { makeHooks } from "@/server/voice";

const HooksRequest = z.object({ count: z.number().int().min(1).max(6).default(3), tone: z.string().max(60).default("") });

/** Hook options for the person to pick from; nothing is saved until they do. */
export const POST = route<{ projectId: string }>(async (req, { projectId }) => {
  const p = req.headers.get("content-length") === "0" ? HooksRequest.parse({}) : await body(req, HooksRequest.prefault({}));
  return makeHooks(projectId, p.count, p.tone);
});
