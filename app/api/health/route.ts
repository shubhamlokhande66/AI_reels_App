import { route } from "@/server/core/http";
import { health } from "@/server/workspace";

export const GET = route(async () => health());
