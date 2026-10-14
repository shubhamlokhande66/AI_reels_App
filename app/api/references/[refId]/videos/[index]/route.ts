import { route } from "@/server/core/http";
import { removeVideo } from "@/server/trends/references";

export const DELETE = route<{ refId: string; index: string }>(async (_req, { refId, index }) => removeVideo(refId, Number.parseInt(index, 10)));
