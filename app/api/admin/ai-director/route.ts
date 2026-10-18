import { requireAdmin } from "@/server/core/admin";
import { route } from "@/server/core/http";
import { report } from "@/server/studio/brain";

/** How the AI director is doing (administrator only): plans made, choices, and how often people changed them. */
export const GET = route(async (req) => {
  await requireAdmin(req);
  return report(30);
});
