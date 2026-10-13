import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { forgot } from "@/server/accounts";

/** Email a link to choose a new password (the same answer whether or not the email has an account). */
export const POST = route(async (req) => forgot((await body(req, z.object({ email: z.string().min(3).max(254) }))).email));
