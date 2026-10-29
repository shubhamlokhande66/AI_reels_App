import { z } from "zod";
import { requireAdmin } from "../../../../server/core/admin";
import { body } from "../../../../server/core/body";
import { route } from "../../../../server/core/http";
import { chooseOllamaModel } from "../../../../server/ai/settingsApi";

/** Choose the Ollama model (null = back to OLLAMA_MODEL from .env). */
export const PUT = route(async (req) => { await requireAdmin(req); return chooseOllamaModel((await body(req, z.object({ model: z.string().max(120).nullish() }))).model ?? null); });
