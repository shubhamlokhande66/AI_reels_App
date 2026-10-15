import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { direct, DirectIn } from "@/server/studio/direct";

/** Fast Studio's AI director: one text call that plans which offered moment, transition, effect and speed each cut gets.
 * The phone validates every choice against its own rules before using it. */
export const POST = route(async (req) => direct(await body(req, DirectIn)));
