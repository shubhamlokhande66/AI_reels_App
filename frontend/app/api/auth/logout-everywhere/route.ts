import { route } from "@/server/core/http";
import { logoutEverywhere } from "@/server/accounts";

export const POST = route(async () => logoutEverywhere());
