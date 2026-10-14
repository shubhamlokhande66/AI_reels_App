import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { chat, ChatRequest } from "@/server/chat";

/** A free-form chat with the AI model (never touches a project). */
export const POST = route(async (req) => chat(await body(req, ChatRequest)));
