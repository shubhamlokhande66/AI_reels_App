import { z } from "zod";
import { requireAdmin } from "@/server/core/admin";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { AffiliateIn, listAffiliates, markAffiliatePaid, updateAffiliate } from "@/server/marketing";

/** Admin → Marketing → Affiliates: everyone in (or asking to join) the program; approve, pause, their %, pay out. */
export const GET = route(async (req) => { await requireAdmin(req); return { affiliates: await listAffiliates() }; });
export const PUT = route(async (req) => { await requireAdmin(req); return updateAffiliate(await body(req, AffiliateIn)); });
export const POST = route(async (req) => { await requireAdmin(req); const p = await body(req, z.object({ id: z.string().max(40), note: z.string().max(200).default("") })); return markAffiliatePaid(p.id, p.note); });
