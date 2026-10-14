import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { reorderVideos } from "@/server/projects/media";
import { projectOut } from "@/server/projects/service";

const VideoOrder = z.object({ ids: z.array(z.string()).min(1).max(500) });

export const PUT = route<{ projectId: string }>(async (req, { projectId }) => projectOut(await reorderVideos(projectId, (await body(req, VideoOrder)).ids)));
