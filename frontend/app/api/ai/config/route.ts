import { requireAdmin } from "@/server/core/admin";
import { route } from "@/server/core/http";
import { configView, putConfig } from "@/server/ai/settingsApi";

export const GET = route(async (req) => { requireAdmin(req); return configView(); });
export const PUT = route(async (req) => { requireAdmin(req); return putConfig(await req.json()); });
