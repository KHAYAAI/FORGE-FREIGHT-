import { Module } from "@nestjs/common";
import { BillingController } from "./billing.controller.js";
import { BillingProfileService } from "./billing-profile.service.js";
import { BillingService } from "./billing.service.js";
import { InvoiceAssemblyService } from "./invoice-assembly.service.js";
import { OverdueSweepService } from "./overdue-sweep.service.js";

@Module({
  controllers: [BillingController],
  providers: [
    BillingService,
    BillingProfileService,
    InvoiceAssemblyService,
    OverdueSweepService,
  ],
  exports: [BillingProfileService, InvoiceAssemblyService],
})
export class BillingModule {}
