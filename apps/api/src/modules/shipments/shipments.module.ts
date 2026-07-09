import { Module } from "@nestjs/common";
import { ShipmentsController } from "./shipments.controller.js";

@Module({
  controllers: [ShipmentsController],
})
export class ShipmentsModule {}
