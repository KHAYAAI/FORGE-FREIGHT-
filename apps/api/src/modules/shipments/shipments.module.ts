import { Module } from "@nestjs/common";
import { ScheduledController } from "./scheduled.controller.js";
import { ShipmentsController } from "./shipments.controller.js";
import { SlaSweepService } from "./sla-sweep.service.js";

@Module({
  controllers: [ShipmentsController, ScheduledController],
  providers: [SlaSweepService],
  exports: [SlaSweepService],
})
export class ShipmentsModule {}
