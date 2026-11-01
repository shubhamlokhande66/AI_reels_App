import { route } from "../../../../../server/core/http";
import { myAffiliateDashboard } from "../../../../../server/marketing";

/** My affiliate dashboard: my link, terms, clicks, customers (usernames), sales, payouts. */
export const GET = route(async () => myAffiliateDashboard());
