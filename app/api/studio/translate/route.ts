import { isAdmin } from "@/server/core/admin";
import { body } from "@/server/core/body";
import { requireAiPlan } from "@/server/credits";
import { route } from "@/server/core/http";
import { translateLines, TranslateIn } from "@/server/studio/translate";

/** Fast Studio: caption lines translated into another language (bilingual or translated captions): Shubix AI (Editor and Pro). */
export const POST = route(async (req) => { await requireAiPlan(await isAdmin(req)); return translateLines(await body(req, TranslateIn)); });
