import { route } from "@/server/core/http";
import { phone } from "@/server/workspace";

export const GET = route(async () => phone());
