import { z } from "zod";
import { requireAdmin } from "@/server/core/admin";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { testModel } from "@/server/chat";

/** Ask an Ollama model to interpret one small change request and grade the answer (nothing is saved). */
export const POST = route(async (req) => { requireAdmin(req); return testModel((await body(req, z.object({ model: z.string().min(1).max(120) }))).model); });
