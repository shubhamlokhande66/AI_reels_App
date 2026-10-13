import { route } from "@/server/core/http";
import { listTrends } from "@/server/trends";

/** Trend presets (camelCase, as in the product spec). */
export const GET = route(async () => listTrends());
