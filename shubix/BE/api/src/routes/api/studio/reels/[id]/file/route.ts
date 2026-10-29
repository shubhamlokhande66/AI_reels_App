import { route } from "../../../../../../server/core/http";
import { receiveFile, reelFile } from "../../../../../../server/studio/reels";

/** GET plays the Reel (?download saves it); PUT receives the file when there is no direct storage (a local install). */
export const GET = route<{ id: string }>(async (req, { id }) => reelFile(req, id));
export const PUT = route<{ id: string }>(async (req, { id }) => receiveFile(id, req));
