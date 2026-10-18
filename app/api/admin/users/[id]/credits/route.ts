import { body } from "@/server/core/body";
import { requireAdmin } from "@/server/core/admin";
import { route } from "@/server/core/http";
import { creditsBody, giveCredits } from "@/server/adminDashboard";

/** Give (positive) or take back (negative) credits by hand. */
export const POST = route<{ id: string }>(async (req, { id }) => {
  await requireAdmin(req);
  const b = await body(req, creditsBody);
  return giveCredits(id, b.credits, b.note);
});
