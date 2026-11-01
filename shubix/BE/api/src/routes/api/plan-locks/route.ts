import { z } from "zod";
import { requireAdmin } from "../../../server/core/admin";
import { body } from "../../../server/core/body";
import { route } from "../../../server/core/http";
import { getLocks, setLocks } from "../../../server/planLocks";

/** What each plan unlocks in Fast Studio (read by the studio and the pricing page); the administrator changes it. */
export const GET = route(async () => getLocks());
const LocksIn = z.object({ items: z.record(z.string(), z.enum(["free", "creator", "pro", "business"])).default({}),
  export: z.record(z.string(), z.object({ maxRes: z.enum(["720", "1080", "4k"]).optional(), fps60: z.boolean().optional(), noWatermark: z.boolean().optional() })).default({}) });
export const PUT = route(async (req) => { await requireAdmin(req); return setLocks(await body(req, LocksIn)); });
