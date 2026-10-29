import { body } from "../../../../server/core/body";
import { route } from "../../../../server/core/http";
import { limits } from "../../../../server/core/rateLimit";
import { ClientError, recordClientError } from "../../../../server/clientErrors";

/** A browser reports an error it ran into (public: guests too), a few a minute at most. */
export const POST = route(async (req) => {
  limits.clientError(req);
  return recordClientError(await body(req, ClientError), req.headers.get("user-agent") ?? "");
});
