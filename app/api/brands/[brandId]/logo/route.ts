import { isPlanAdmin } from "@/server/core/admin";
import { requirePlanItem } from "@/server/planLocks";
import { route, sendFile } from "@/server/core/http";
import { logoFile, uploadLogo } from "@/server/brands";

export const GET = route<{ brandId: string }>(async (req, { brandId }) => sendFile(req, await logoFile(brandId), "image/png"));
export const POST = route<{ brandId: string }>(async (req, { brandId }) => { await requirePlanItem("page:brand", await isPlanAdmin(req)); return uploadLogo(brandId, req); });
