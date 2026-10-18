import { requireAdmin } from "@/server/core/admin";
import { route } from "@/server/core/http";
import { userDetail } from "@/server/adminDashboard";

export const GET = route<{ id: string }>(async (req, { id }) => { await requireAdmin(req); return userDetail(id); });
