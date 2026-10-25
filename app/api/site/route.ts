import { route } from "@/server/core/http";
import { getSite } from "@/server/site";

/** The business details for the legal and contact pages (public): the administrator's, else the environment's. */
export const GET = route(async () => getSite());
