import { route } from "@/server/core/http";
import { limits } from "@/server/core/rateLimit";
import { sendAdminCode } from "@/server/accounts";

/** The administrator's daily code: email it to the signed-in admin account. */
export const POST = route(async (req) => { limits.account(req); return sendAdminCode(); });
