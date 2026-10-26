import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { limits } from "@/server/core/rateLimit";
import { ContactIn, sendContact } from "@/server/support";

/** The Contact page's message (public: anyone may write; limited per address and per email). */
export const POST = route(async (req) => { const p = await body(req, ContactIn); limits.contact(req, p.email); return sendContact(p); });
