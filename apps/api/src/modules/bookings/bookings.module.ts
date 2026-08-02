import { Module } from "@nestjs/common";
import { ConsignmentsModule } from "../consignments/consignments.module.js";
import { ComplianceModule } from "../compliance/compliance.module.js";
import { BookingsController } from "./bookings.controller.js";
import { BookingsService } from "./bookings.service.js";

@Module({
  imports: [ComplianceModule, ConsignmentsModule],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
