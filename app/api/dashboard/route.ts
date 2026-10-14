import { route } from "@/server/core/http";
import { dashboard } from "@/server/workspace";

export const GET = route(async () => dashboard());
