import { route } from "@/server/core/http";
import { groupLibrary } from "@/server/trends/references";

/** Sort every learned Reel into editing styles. */
export const POST = route(async () => groupLibrary());
