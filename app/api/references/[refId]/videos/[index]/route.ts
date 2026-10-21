import { requireAdmin } from "@/server/core/admin";
import { route } from "@/server/core/http";
import { removeVideo } from "@/server/trends/references";

export const DELETE = route<{ refId: string; index: string }>(async (req, { refId, index }) => { await requireAdmin(req); return removeVideo(refId, Number.parseInt(index, 10)); });
