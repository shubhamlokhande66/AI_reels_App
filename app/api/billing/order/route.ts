import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { createOrder } from "@/server/credits";

export const POST = route(async (req) => createOrder((await body(req, z.object({ item: z.string().max(60) }))).item));
