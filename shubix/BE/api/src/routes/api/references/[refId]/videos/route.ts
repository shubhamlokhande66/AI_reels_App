import { requireAdmin } from "../../../../../server/core/admin";
import { route } from "../../../../../server/core/http";
import { addVideos } from "../../../../../server/trends/references";

export const POST = route<{ refId: string }>(async (req, { refId }) => { await requireAdmin(req); return addVideos(refId, req); });
