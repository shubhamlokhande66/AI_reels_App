import { requireAdmin } from "@/server/core/admin";
import { route } from "@/server/core/http";
import { ollamaState } from "@/server/ai/settingsApi";

/** The Ollama models installed on this computer and the one in use. */
export const GET = route(async (req) => { requireAdmin(req); return ollamaState(); });
