import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { limits } from "@/server/core/rateLimit";
import { PartnerApplyIn, partnerApply } from "@/server/partner";

/** Ask to join the affiliate program from the partner dashboard (the administrator approves). */
export const POST = route(async (req) => { limits.account(req); return partnerApply(req, (await body(req, PartnerApplyIn)).note); });
