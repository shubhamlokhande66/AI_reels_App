import { ExecutionContext, Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { errorBody } from "../server/core/errors";
import { AuthRequired } from "../server/core/auth";

/** Protects a native route: only a signed-in person (req.user = { id }). A refusal is the app's usual 401 JSON. */
@Injectable()
export class SessionGuard extends AuthGuard("session") {
  handleRequest<T>(err: unknown, user: T, _info: unknown, ctx: ExecutionContext): T {
    if (err || !user) {
      const e = err instanceof AuthRequired ? err : new AuthRequired();
      ctx.switchToHttp().getResponse().status(401).json(errorBody(e.code, e.message));
      throw new SentResponse();
    }
    return user;
  }
}
/** the answer was already sent by the guard */
export class SentResponse extends Error {}
