import { adminState } from "../../../../server/core/admin";
import { route } from "../../../../server/core/http";

/** Whether this browser is in admin mode (required = an admin key is configured). */
export const GET = route(async (req) => adminState(req));
