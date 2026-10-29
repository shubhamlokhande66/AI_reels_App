import { Controller, Get, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../auth/session.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { SessionUser } from "../auth/session.strategy";
import { withUser } from "../server/core/auth";
import { me } from "../server/accounts";

/** A native Nest route behind Passport: the signed-in account (the same answer as /api/auth/me). */
@Controller("api/users")
@UseGuards(SessionGuard)
export class UsersController {
  @Get("me") me(@CurrentUser() u: SessionUser) { return withUser(u.id, () => me()); }
}
