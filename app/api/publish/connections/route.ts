import { route } from "@/server/core/http";
import { connections } from "@/server/publish";

/** Which platforms this server can post to, and the .env settings still missing for the others. */
export const GET = route(async () => connections());
