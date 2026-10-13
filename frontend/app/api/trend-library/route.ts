import { route } from "@/server/core/http";
import { clearLibrary, trendLibrary } from "@/server/trends/references";

export const GET = route(async () => trendLibrary());
export const DELETE = route(async () => { await clearLibrary(); return undefined; });
