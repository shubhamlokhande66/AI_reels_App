import { route, sendFile } from "@/server/core/http";
import { publicReelFile } from "@/server/publish";

/** The Reel file for a platform to download: only with a signed, unexpired link (no sign-in). */
export const GET = route<{ token: string }>(async (req, { token }) => sendFile(req, await publicReelFile(token), "video/mp4"));
