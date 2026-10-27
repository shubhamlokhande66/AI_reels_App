import { route } from "@/server/core/http";
import { partnerLogout } from "@/server/partner";

/** Sign out of the partner dashboard (a Shubix session stays as it is). */
export const POST = route(async () => partnerLogout());
