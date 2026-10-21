import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { ping, pingBody } from "@/server/adminDashboard";
import { limits } from "@/server/core/rateLimit";

/** An open tab is still here (public: guests count as visitors too). */
export const POST = route(async (req) => {
  const b = await body(req, pingBody);
  limits.ping(req, b.visitor);
  return ping(b.visitor, b.path, req.headers.get("user-agent") ?? "", b.app);
});
