import { route } from "@/server/core/http";
import { markUsed } from "@/server/songs/service";

export const POST = route<{ songId: string }>(async (_req, { songId }) => {
  await markUsed(songId);
});
