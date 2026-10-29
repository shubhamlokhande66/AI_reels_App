import { route } from "../../../../server/core/http";
import { partnerMe } from "../../../../server/partner";

/** The partner dashboard: who is here, the program's terms, their affiliate picture. */
export const GET = route(async (req) => partnerMe(req));
