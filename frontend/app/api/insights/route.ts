import { route } from "@/server/core/http";
import { insights } from "@/server/workspace";

/** What worked, from the person's own posted Reels (small samples are flagged; nothing predicts results). */
export const GET = route(async () => insights());
