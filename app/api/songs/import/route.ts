import { route } from "@/server/core/http";
import { importFolders } from "@/server/songs/service";

/** Scan the watched folders right away. */
export const POST = route(async () => importFolders(true));
