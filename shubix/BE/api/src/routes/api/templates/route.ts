import { requireAdmin } from "../../../server/core/admin";
import { body } from "../../../server/core/body";
import { route } from "../../../server/core/http";
import { allTemplates, liveList, resetTemplates, saveTemplates, TemplatesIn } from "../../../server/studioTemplates";

/** Fast Studio's templates. GET: the ones people see today (Home, Templates, the studio); ?all=1 every one, for the
 * administrator. PUT: the administrator saves the whole list. DELETE: back to the defaults. */
export const GET = route(async (req) => {
  if (new URL(req.url).searchParams.get("all") === "1") { await requireAdmin(req); return allTemplates(); }
  return liveList();
});
export const PUT = route(async (req) => { await requireAdmin(req); return saveTemplates((await body(req, TemplatesIn)).templates); });
export const DELETE = route(async (req) => { await requireAdmin(req); return resetTemplates(); });
