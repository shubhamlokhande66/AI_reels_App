import { route } from "../../../../../server/core/http";
import { convertStatus } from "../../../../../server/studio/convert";

/** A conversion's progress: { status: running | done | failed, progress 0-1, error }. */
export const GET = route<{ id: string }>(async (_req, { id }) => convertStatus(id));
