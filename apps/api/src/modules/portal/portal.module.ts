import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module.js";
import { PortalController } from "./portal.controller.js";

@Module({ imports: [DbModule], controllers: [PortalController] })
export class PortalModule {}
