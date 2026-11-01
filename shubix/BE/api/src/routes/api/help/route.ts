import { body } from "../../../server/core/body";
import { route } from "../../../server/core/http";
import { limits } from "../../../server/core/rateLimit";
import { ChatIn, getSupport, helpChat } from "../../../server/support";

/** The Help chat: whether it is on (GET), and one answer (POST; public, limited per person and per address). */
export const GET = route(async () => ({ on: (await getSupport()).chat }));
export const POST = route(async (req) => { limits.helpChat(req); return helpChat(await body(req, ChatIn)); });
