import { route } from "../../../server/core/http";
import { myMarketing } from "../../../server/marketing";

/** Invite & earn: my username and invite link, what an invite gives, my invites, sending credits, my affiliate account. */
export const GET = route(async () => myMarketing());
