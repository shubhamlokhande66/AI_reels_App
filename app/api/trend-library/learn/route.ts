import { route } from "@/server/core/http";
import { learn } from "@/server/trends/references";

/** Measure a few more trending Reels into the learning library. */
export const POST = route(async (req) => learn(req));
