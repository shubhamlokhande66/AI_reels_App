import { route } from "../../../server/core/http";
import { getTexts } from "../../../server/texts";

/** The administrator's texts (everyone reads them: every page shows them). */
export const GET = route(async () => getTexts());
