import { isPlanAdmin } from "@/server/core/admin";
import { requirePlanItem } from "@/server/planLocks";
import { requireFeature } from "@/server/core/features";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { BrandIn, createBrand, listBrands } from "@/server/brands";

export const GET = route(async () => listBrands());
export const POST = route(async (req) => {
  await requireFeature(req, "brands");
  await requirePlanItem("page:brand", await isPlanAdmin(req));
  return Response.json(await createBrand(await body(req, BrandIn)), { status: 201 });
});
