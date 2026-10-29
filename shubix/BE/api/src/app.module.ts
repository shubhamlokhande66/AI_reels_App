import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { RoutingModule } from "./routing/routing.module";

// RoutingModule last: its catch-all answers whatever the native modules do not
@Module({ imports: [AuthModule, UsersModule, RoutingModule] })
export class AppModule {}
