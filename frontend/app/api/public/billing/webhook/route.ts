import { route } from "@/server/core/http";
import { webhook } from "@/server/credits";

/** Razorpay calls this, signed with the webhook secret. */
export const POST = route(async (req) => webhook(req));
