import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { changePassword } from "@/server/accounts";

export const POST = route(async (req) => { const p = await body(req, z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) })); return changePassword(p.currentPassword, p.newPassword); });
