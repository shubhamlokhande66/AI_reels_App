import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { translateLines, TranslateIn } from "@/server/studio/translate";

/** Fast Studio: caption lines translated into another language (bilingual or translated captions). */
export const POST = route(async (req) => translateLines(await body(req, TranslateIn)));
