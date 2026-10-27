import { z } from "zod";
import { requireAdmin } from "@/server/core/admin";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { BroadcastIn, deleteBroadcast, listBroadcasts, sendBroadcast } from "@/server/broadcasts";

/** Admin → Messages: the messages sent (GET), send one or count who would get it (POST), take one off the bells (DELETE). */
export const GET = route(async (req) => { await requireAdmin(req); return listBroadcasts(); });
export const POST = route(async (req) => { await requireAdmin(req); return sendBroadcast(await body(req, BroadcastIn)); });
export const DELETE = route(async (req) => { await requireAdmin(req); return deleteBroadcast((await body(req, z.object({ id: z.string().max(40) }))).id); });
