import { isPlanAdmin } from "@/server/core/admin";
import { requirePlanItem } from "@/server/planLocks";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { BrandIn, deleteBrand, getBrand, updateBrand } from "@/server/brands";

export const GET = route<{ brandId: string }>(async (_req, { brandId }) => getBrand(brandId));
export const PATCH = route<{ brandId: string }>(async (req, { brandId }) => { await requirePlanItem("page:brand", await isPlanAdmin(req)); return updateBrand(brandId, await body(req, BrandIn)); });
export const DELETE = route<{ brandId: string }>(async (_req, { brandId }) => { await deleteBrand(brandId); return undefined; });
