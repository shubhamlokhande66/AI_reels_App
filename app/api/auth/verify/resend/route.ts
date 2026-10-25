import { route } from "@/server/core/http";
import { resendVerify } from "@/server/accounts";
import { limits } from "@/server/core/rateLimit";

/** The signed-in person asks for the "Verify my email" link again. */
export const POST = route(async (req) => { limits.account(req); return resendVerify(); });
