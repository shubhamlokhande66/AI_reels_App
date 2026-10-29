import { route } from "../../../../server/core/http";
import { limits } from "../../../../server/core/rateLimit";
import { applyAffiliate } from "../../../../server/marketing";

/** Ask to join the affiliate program (the administrator approves). */
export const POST = route(async (req) => { limits.account(req); return applyAffiliate(); });
