import { z } from "zod";
import { addAdmin, listAdmins, removeAdmin, requireAdmin } from "../../../../server/core/admin";
import { body } from "../../../../server/core/body";
import { route } from "../../../../server/core/http";

/** Admin → Settings → Administrators: the owners (ADMIN_EMAILS, set on the server) and the ones added here. */
const EmailIn = z.object({ email: z.string().trim().max(200) });
export const GET = route(async (req) => { await requireAdmin(req); return listAdmins(); });
export const POST = route(async (req) => { await requireAdmin(req); return addAdmin((await body(req, EmailIn)).email); });
export const DELETE = route(async (req) => { await requireAdmin(req); return removeAdmin((await body(req, EmailIn)).email); });
