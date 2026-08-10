import { Module } from "@nestjs/common";
import { CarrierConfirmationService } from "./carrier-confirmation.service.js";
import { ScheduledController } from "./scheduled.controller.js";
import { ShipmentsController } from "./shipments.controller.js";
import { SlaSweepService } from "./sla-sweep.service.js";

@Module({
  controllers: [ShipmentsController, ScheduledController],
  providers: [SlaSweepService, CarrierConfirmationService],
  exports: [SlaSweepService, CarrierConfirmationService],
})
export class ShipmentsModule {}
