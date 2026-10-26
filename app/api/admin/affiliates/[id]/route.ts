import { requireAdmin } from "@/server/core/admin";
import { route } from "@/server/core/http";
import { affiliateDetail } from "@/server/marketing";

/** Admin → Marketing → Affiliates → a partner: everything about them (customers with their emails, sales, payouts). */
export const GET = route<{ id: string }>(async (req, { id }) => { await requireAdmin(req); return affiliateDetail(id, true); });
