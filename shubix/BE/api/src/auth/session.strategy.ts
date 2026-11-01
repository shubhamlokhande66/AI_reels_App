import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy } from "passport-custom";
import type { Request } from "express";
import { AuthRequired, COOKIE, readSession, sessionValid } from "../server/core/auth";

/** Passport for native Nest routes, the same session as every other endpoint (server/core/auth.ts): the website's
 * httpOnly cookie or the phone app's Bearer token, valid only while the account's session version matches. */
function token(req: Request): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
  }
  const authz = req.headers.authorization ?? "";
  return authz.toLowerCase().startsWith("bearer ") ? authz.slice(7) : null;
}
export type SessionUser = { id: string };

@Injectable()
export class SessionStrategy extends PassportStrategy(Strategy, "session") {
  async validate(req: Request): Promise<SessionUser> {
    const s = readSession(token(req));
    if (!s || !(await sessionValid(s[0], s[1]))) throw new AuthRequired();
    return { id: s[0] };
  }
}
