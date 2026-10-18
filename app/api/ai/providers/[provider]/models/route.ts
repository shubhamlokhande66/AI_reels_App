import { requireAdmin } from "@/server/core/admin";
import { route } from "@/server/core/http";
import { providerModels } from "@/server/ai/settingsApi";

/** Models the provider offers (Ollama: installed; the cloud ones: listed by their API with the configured key). */
export const GET = route<{ provider: string }>(async (req, { provider }) => { await requireAdmin(req); return providerModels(provider); });
