import { route } from "../../../../server/core/http";
import { logout } from "../../../../server/accounts";

export const POST = route(async () => logout());
