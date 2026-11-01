import { requireAdmin } from "../../../../server/core/admin";
import { route } from "../../../../server/core/http";
import { listUsers } from "../../../../server/adminDashboard";

/** Administration → Users: every account with its logins, purchases and credits left. */
export const GET = route(async (req) => { await requireAdmin(req); return listUsers(); });
