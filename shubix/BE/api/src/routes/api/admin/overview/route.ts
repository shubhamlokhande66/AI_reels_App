import { requireAdmin } from "../../../../server/core/admin";
import { route } from "../../../../server/core/http";
import { overview } from "../../../../server/adminDashboard";

/** Administration → Overview: visitors online now, sign-ups, revenue, credits. */
export const GET = route(async (req) => { await requireAdmin(req); return overview(); });
