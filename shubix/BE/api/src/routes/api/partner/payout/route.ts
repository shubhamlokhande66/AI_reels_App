import { body } from "../../../../server/core/body";
import { route } from "../../../../server/core/http";
import { limits } from "../../../../server/core/rateLimit";
import { PayoutIn } from "../../../../server/marketing";
import { partnerPayout } from "../../../../server/partner";

/** Where the partner is paid (a UPI ID or a bank account). */
export const PUT = route(async (req) => { limits.account(req); return partnerPayout(req, await body(req, PayoutIn)); });
