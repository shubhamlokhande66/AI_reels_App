import { z } from "zod";
import { requireAdmin } from "@/server/core/admin";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { clearClientError, listClientErrors } from "@/server/clientErrors";

/** Admin: the errors people's browsers ran into (last 30 days), and marking one as fixed. */
export const GET = route(async (req) => { await requireAdmin(req); return listClientErrors(); });
export const DELETE = route(async (req) => { await requireAdmin(req); return clearClientError((await body(req, z.object({ id: z.string().max(40) }))).id); });
