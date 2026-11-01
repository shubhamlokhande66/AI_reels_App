import { z } from "zod";
import { body } from "../../../../../server/core/body";
import { route } from "../../../../../server/core/http";
import { deleteReel, renameReel } from "../../../../../server/studio/reels";

const RenameIn = z.object({ name: z.string().trim().min(1).max(120) });

export const PATCH = route<{ id: string }>(async (req, { id }) => renameReel(id, (await body(req, RenameIn)).name));
export const DELETE = route<{ id: string }>(async (_req, { id }) => deleteReel(id));
