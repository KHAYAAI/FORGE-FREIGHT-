import { Module } from "@nestjs/common";
import { BillingController } from "./billing.controller.js";
import { BillingService } from "./billing.service.js";
import { OverdueSweepService } from "./overdue-sweep.service.js";

@Module({
  controllers: [BillingController],
  providers: [BillingService, OverdueSweepService],
})
export class BillingModule {}
