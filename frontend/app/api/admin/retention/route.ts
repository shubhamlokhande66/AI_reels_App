import { z } from "zod";
import { requireAdmin } from "@/server/core/admin";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { setRetention } from "@/server/workspace";

const RetentionIn = z.object({ enabled: z.boolean(), uploadsHours: z.number().int().min(1).max(24 * 90), projectsHours: z.number().int().min(1).max(24 * 90) });

export const PUT = route(async (req) => {
  requireAdmin(req);
  const p = await body(req, RetentionIn);
  return setRetention(p.enabled, p.uploadsHours, p.projectsHours);
});
