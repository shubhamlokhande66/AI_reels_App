import { route } from "@/server/core/http";
import { site } from "@/server/workspace";

/** The business details for the legal and contact pages (public). */
export const GET = route(async () => site());
