import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { limits } from "@/server/core/rateLimit";
import { PayoutIn, setPayoutDetails } from "@/server/marketing";

/** An affiliate's payout details (a UPI ID or a bank account): where the administrator sends their commission. */
export const PUT = route(async (req) => { limits.account(req); return setPayoutDetails(await body(req, PayoutIn)); });
