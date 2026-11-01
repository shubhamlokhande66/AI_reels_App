import { z } from "zod";
import { requireAdmin } from "../../../../server/core/admin";
import { body } from "../../../../server/core/body";
import { route } from "../../../../server/core/http";
import { setMessageStatus, setSupport, SupportIn, supportInbox } from "../../../../server/support";

/** Admin → Support: the messages (?status=open|done|all), the Help chat's recent questions and its switches (GET); the
 * switches (PUT); a message marked done or open again (POST). */
export const GET = route(async (req) => { await requireAdmin(req); const s = new URL(req.url).searchParams.get("status"); return supportInbox(s === "done" || s === "all" ? s : "open"); });
export const PUT = route(async (req) => { await requireAdmin(req); return setSupport(await body(req, SupportIn)); });
export const POST = route(async (req) => { await requireAdmin(req); const p = await body(req, z.object({ id: z.string().max(20), status: z.enum(["open", "done"]) })); return setMessageStatus(p.id, p.status); });
