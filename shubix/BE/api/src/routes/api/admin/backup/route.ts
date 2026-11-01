import { requireAdmin } from "../../../../server/core/admin";
import { route } from "../../../../server/core/http";
import { backupStream } from "../../../../server/backup";

/** Admin: download the whole database (server/backup.ts). */
export const GET = route(async (req) => {
  await requireAdmin(req);
  const day = new Date().toISOString().slice(0, 10);
  return new Response(await backupStream(), { headers: {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Content-Disposition": `attachment; filename="shubix-backup-${day}.ndjson"`,
    "Cache-Control": "no-store",
  } });
});
