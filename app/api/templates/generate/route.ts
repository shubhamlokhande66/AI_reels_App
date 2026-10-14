import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { generateTemplate } from "@/server/workspace";

/** The AI proposes a template; it is NOT saved (the person reviews it, then saves it with POST /api/templates). */
export const POST = route(async (req) => generateTemplate((await body(req, z.object({ prompt: z.string().min(3).max(300) }))).prompt));
