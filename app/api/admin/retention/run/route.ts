import { requireAdmin } from "@/server/core/admin";
import { route } from "@/server/core/http";
import { sweep } from "@/server/workspace";

/** Run the auto-delete now (it also runs by itself every 10 minutes). */
export const POST = route(async (req) => { await requireAdmin(req); return sweep(); });
