import { requireAdmin } from "@/server/core/admin";
import { route } from "@/server/core/http";
import { usage } from "@/server/ai/settingsApi";

export const GET = route(async (req) => { requireAdmin(req); return usage(); });
