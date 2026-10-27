import { isAdmin } from "@/server/core/admin";
import { route } from "@/server/core/http";
import { health } from "@/server/workspace";

/** Is the server up? Everyone (an uptime monitor) gets ok / degraded; the administrator also gets the database and the
 * AI's details (Tools → AI settings): provider and model names are not for the public. */
export const GET = route(async (req) => {
  const h = await health();
  return (await isAdmin(req)) ? h : { status: h.status };
});
