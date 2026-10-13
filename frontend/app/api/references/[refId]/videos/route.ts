import { route } from "@/server/core/http";
import { addVideos } from "@/server/trends/references";

export const POST = route<{ refId: string }>(async (req, { refId }) => addVideos(refId, req));
