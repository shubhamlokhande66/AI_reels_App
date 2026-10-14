import { route } from "@/server/core/http";
import { deleteSong } from "@/server/songs/service";

export const DELETE = route<{ songId: string }>(async (_req, { songId }) => {
  await deleteSong(songId);
});
