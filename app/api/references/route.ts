import { requireAdmin } from "@/server/core/admin";
import { route } from "@/server/core/http";
import { createReference, listReferences } from "@/server/trends/references";

export const GET = route(async () => listReferences());
/** A new trend from uploaded reference Reels (measured, then deleted: only the numbers are kept). */
export const POST = route(async (req) => { await requireAdmin(req); return Response.json(await createReference(req), { status: 201 }); });
