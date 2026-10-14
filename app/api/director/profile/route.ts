import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { getDirectorProfile, resetDirectorProfile, setDirectorProfile } from "@/server/workspace";

export const GET = route(async () => getDirectorProfile());
export const PUT = route(async (req) => setDirectorProfile((await body(req, z.object({ enabled: z.boolean() }))).enabled));
export const DELETE = route(async () => resetDirectorProfile());
