import { route } from "@/server/core/http";
import { stylesList } from "@/server/workspace";

export const GET = route(async () => stylesList());
