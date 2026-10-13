import { route } from "@/server/core/http";
import { chatFile } from "@/server/chat";

/** Read an attachment for the chat (nothing is saved). */
export const POST = route(async (req) => chatFile(req));
