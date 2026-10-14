import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { deleteAccount } from "@/server/accounts";

/** Delete the account and all its data, for good (the password and the email typed again). */
export const POST = route(async (req) => { const p = await body(req, z.object({ password: z.string().min(1).max(200), confirm: z.string().max(254) })); return deleteAccount(p.password, p.confirm); });
