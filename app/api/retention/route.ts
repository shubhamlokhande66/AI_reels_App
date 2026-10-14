import { route } from "@/server/core/http";
import { getRetention } from "@/server/workspace";

/** How long uploads and projects are kept. */
export const GET = route(async () => getRetention());
