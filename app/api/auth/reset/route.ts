import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { reset } from "@/server/accounts";
import { limits } from "@/server/core/rateLimit";

export const POST = route(async (req) => { const p = await body(req, z.object({ token: z.string().min(20).max(200), password: z.string().min(1).max(200) })); limits.reset(req); return reset(p.token, p.password); });
