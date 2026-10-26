import { requireAdmin } from "@/server/core/admin";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { getMarketing, marketingReport, MarketingIn, setMarketing } from "@/server/marketing";

/** Admin → Marketing: the invite, sending and affiliate settings, and how the programs are doing. */
export const GET = route(async (req) => { await requireAdmin(req); const [settings, report] = await Promise.all([getMarketing(), marketingReport()]); return { settings, report }; });
export const PUT = route(async (req) => { await requireAdmin(req); return { settings: await setMarketing(await body(req, MarketingIn)) }; });
