import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { PassportModule } from "@nestjs/passport";
import { SessionStrategy } from "./session.strategy";
import { AppErrorFilter } from "./auth.filter";

/** Sign-in itself is /api/auth/* (src/routes/api/auth, server/accounts.ts); this module gives native routes the guard. */
@Module({ imports: [PassportModule], providers: [SessionStrategy, { provide: APP_FILTER, useClass: AppErrorFilter }], exports: [PassportModule] })
export class AuthModule {}
