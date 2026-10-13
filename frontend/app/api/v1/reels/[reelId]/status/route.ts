import { route } from "@/server/core/http";
import { reelStatus } from "@/server/ai/aiTimeline";

/** Rendering progress and, when done, the video's URL. */
export const GET = route<{ reelId: string }>(async (_req, { reelId }) => reelStatus(reelId));
