import { route } from "@/server/core/http";
import { myPayments } from "@/server/credits";

export const GET = route(async () => myPayments());
