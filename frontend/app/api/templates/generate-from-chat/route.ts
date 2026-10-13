import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { generateTemplateFromChat } from "@/server/workspace";

/** The Chat tab's "Save as Reel template": a draft to review, never saved by itself. */
export const POST = route(async (req) => generateTemplateFromChat((await body(req, z.object({ transcript: z.string().min(3).max(8000) }))).transcript));
