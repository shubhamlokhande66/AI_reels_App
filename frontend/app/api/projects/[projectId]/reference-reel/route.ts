import { route } from "@/server/core/http";
import { getReferenceReel, removeReferenceReel, setReferenceReel } from "@/server/trends/references";

export const GET = route<{ projectId: string }>(async (_req, { projectId }) => getReferenceReel(projectId));
/** Measure the Reel the person wants theirs to be like (shot by shot); with use_audio its sound becomes the song. */
export const POST = route<{ projectId: string }>(async (req, { projectId }) => setReferenceReel(projectId, req));
export const DELETE = route<{ projectId: string }>(async (_req, { projectId }) => { await removeReferenceReel(projectId); return undefined; });
