import { route } from "@/server/core/http";
import { myNotifications, readNotifications } from "@/server/broadcasts";

/** The bell: the administrator's messages for this person (GET), all read (POST). */
export const GET = route(async () => myNotifications());
export const POST = route(async () => readNotifications());
