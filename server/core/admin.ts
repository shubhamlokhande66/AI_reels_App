import "server-only";
import crypto from "node:crypto";
import { settings } from "./config";
import { AppError } from "./errors";

/** Admin access (was core/admin.py): with ADMIN_KEY set, admin endpoints need the X-Admin-Key header; without it
 * (a local install) everyone is admin. */

export function isAdmin(req: Request): boolean {
  const key = settings.adminKey;
  if (!key) return true;
  const given = req.headers.get("x-admin-key") ?? "";
  return Boolean(given) && given.length === key.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key));
}

export function requireAdmin(req: Request) {
  if (!isAdmin(req)) throw new AppError("This part of the app is for the administrator.", { code: "ADMIN_ONLY", status: 403 });
}

export const adminRequired = () => Boolean(settings.adminKey);
