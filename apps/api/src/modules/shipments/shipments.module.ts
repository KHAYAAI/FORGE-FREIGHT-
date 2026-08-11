import { Module } from "@nestjs/common";
import { PolicyModule } from "../policy/policy.module.js";
import { CarrierConfirmationService } from "./carrier-confirmation.service.js";
import { ScheduledController } from "./scheduled.controller.js";
import { ShipmentsController } from "./shipments.controller.js";
import { SlaSweepService } from "./sla-sweep.service.js";

@Module({
  imports: [PolicyModule],
  controllers: [ShipmentsController, ScheduledController],
  providers: [SlaSweepService, CarrierConfirmationService],
  exports: [SlaSweepService, CarrierConfirmationService],
})
export class ShipmentsModule {}
