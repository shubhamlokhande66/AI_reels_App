import { requireAdmin } from "@/server/core/admin";
import { route } from "@/server/core/http";
import { adminDeleteUser } from "@/server/accounts";
import { userDetail } from "@/server/adminDashboard";

export const GET = route<{ id: string }>(async (req, { id }) => { await requireAdmin(req); return userDetail(id); });
/** Admin → Users → a person → Delete account: everything in it goes (asked first, the email typed). */
export const DELETE = route<{ id: string }>(async (req, { id }) => { await requireAdmin(req); return adminDeleteUser(id); });
