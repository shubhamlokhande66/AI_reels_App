import { Module } from "@nestjs/common";
import { RouteTable } from "./route-table";
import { RoutingController } from "./routing.controller";

@Module({ providers: [RouteTable], controllers: [RoutingController] })
export class RoutingModule {}
