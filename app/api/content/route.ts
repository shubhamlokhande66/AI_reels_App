import { route } from "@/server/core/http";
import { getContent } from "@/server/content";

/** The administrator's lists (Home's cards, tips, questions…): everyone reads them, every page shows them. */
export const GET = route(async () => getContent());
