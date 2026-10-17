import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { shareReel } from "@/server/studio/reels";

const ShareIn = z.object({ on: z.boolean() });

/** Turn the Reel's public link on or off. */
export const POST = route<{ id: string }>(async (req, { id }) => shareReel(id, (await body(req, ShareIn)).on));
