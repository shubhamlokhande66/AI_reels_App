import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { reorderImages } from "@/server/projects/media";

const ImageOrder = z.object({ ids: z.array(z.string()).min(1).max(50) });

export const PUT = route<{ projectId: string }>(async (req, { projectId }) => reorderImages(projectId, (await body(req, ImageOrder)).ids));
