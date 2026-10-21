import { z } from "zod";
import { requireAdmin } from "@/server/core/admin";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { ApproveIn, approveSuggestion, listSuggestions, removeSuggestion } from "@/server/studio/styles";

/** Admin: the Reels creators copied, waiting to teach the styles; use one (under a kind) or remove it. */
export const GET = route(async (req) => { await requireAdmin(req); return listSuggestions(); });
export const POST = route(async (req) => { await requireAdmin(req); return approveSuggestion(await body(req, ApproveIn)); });
export const DELETE = route(async (req) => { await requireAdmin(req); return removeSuggestion((await body(req, z.object({ id: z.string().max(40) }))).id); });
