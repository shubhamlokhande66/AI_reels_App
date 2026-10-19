import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { register } from "@/server/accounts";
import { limits } from "@/server/core/rateLimit";

export const POST = route(async (req) => { const p = await body(req, z.object({ email: z.string().min(3).max(254), password: z.string().min(1).max(200) })); limits.register(req); return register(p.email, p.password); });
