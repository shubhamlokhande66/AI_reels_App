import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { projectVideos, videoReport } from "@/server/video/clips";

const VideoRequest = z.object({ projectId: z.string(), understand: z.boolean().default(false) });

/** The project's clips analysed (once; saved): size, quality, flags, good parts, scene cuts, best segments, and which
 * uploads are copies of another. */
export const POST = route(async (req) => {
  const { projectId, understand } = await body(req, VideoRequest);
  const { projectId: pid, videos } = await projectVideos(projectId);
  return videoReport(pid, videos, understand);
});
