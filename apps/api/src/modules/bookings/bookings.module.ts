import { Module } from "@nestjs/common";
import { ComplianceModule } from "../compliance/compliance.module.js";
import { BookingsController } from "./bookings.controller.js";
import { BookingsService } from "./bookings.service.js";

@Module({
  imports: [ComplianceModule],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
