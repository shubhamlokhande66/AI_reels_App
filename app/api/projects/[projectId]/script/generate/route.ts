import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { generateScript, MAX_HOOK_CHARS } from "@/server/voice";

const Req = z.object({ hook: z.string().max(MAX_HOOK_CHARS).nullable().default(null), cta: z.string().max(100).nullable().default(null), tone: z.string().max(60).default(""), targetSeconds: z.number().min(5).max(600).nullable().default(null) });

export const POST = route<{ projectId: string }>(async (req, { projectId }) => {
  const p = req.headers.get("content-length") === "0" ? Req.parse({}) : await body(req, Req.prefault({}));
  return generateScript(projectId, p);
});
