import { requireAdmin } from "@/server/core/admin";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { CouponIn, deleteCoupon, listCoupons, saveCoupon } from "@/server/marketing";

/** Admin → Marketing → Coupons: list, add or change (by its code), remove (?code=). */
export const GET = route(async (req) => { await requireAdmin(req); return { coupons: await listCoupons() }; });
export const PUT = route(async (req) => { await requireAdmin(req); return saveCoupon(await body(req, CouponIn)); });
export const DELETE = route(async (req) => { await requireAdmin(req); return deleteCoupon(new URL(req.url).searchParams.get("code") ?? ""); });
